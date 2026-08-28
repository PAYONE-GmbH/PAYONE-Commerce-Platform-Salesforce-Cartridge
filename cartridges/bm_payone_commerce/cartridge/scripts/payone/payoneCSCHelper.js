'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var Calendar = require('dw/util/Calendar');
var StringUtils = require('dw/util/StringUtils');
var Money = require('dw/value/Money');
var Resource = require('dw/web/Resource');

var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');
var paymentExecutionService = require('*/cartridge/scripts/services/paymentExecutionService');
var CartItemInput = require('*/cartridge/scripts/models/payone/CartItemInput');
var payoneCSCRequestBuilder = require('*/cartridge/scripts/payone/payoneCSCRequestBuilder');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var toArray = PayoneCommonUtils.toArray;
var readCustomAttribute = PayoneCommonUtils.readCustomAttribute;
var hasCustomAttribute = PayoneCommonUtils.hasCustomAttribute;
var parseJson = PayoneCommonUtils.parseJson;

var CSC_RETURN_REASON = 'Customer Service Center refund';
var ITEM_LEVEL_STATUS_ATTRIBUTE = 'payoneItemLevelStatuses';
var ORDER_AMOUNT_ACTION_USED_ATTRIBUTE = 'payoneOrderAmountActionUsed';
var CSC_CANCEL_REASONS = [
    'CONSUMER_REQUEST',
    'UNDELIVERABLE',
    'DUPLICATE',
    'FRAUDULENT',
    'ORDER_SHIPPED_IN_FULL',
    'AUTOMATED_SHIPMENT_FAILED'
];

/**
 * Reads a localized CSC message from the bm resource bundle.
 *
 * @param {string} key - Resource key in `payonebm.properties`.
 * @returns {string} Localized message or key fallback from SFCC.
 */
function getMessage(key) {
    return Resource.msg(key, 'payonebm', null);
}

/**
 * Returns the warning shown when item-level CSC tracking metadata is unavailable.
 *
 * @returns {string} Localized item-level metadata warning.
 */
function getItemLevelMetadataWarning() {
    var resourceKey = 'csc.warning.itemlevelactionsnotallowedduetomissingmetadata';
    var localized = getMessage(resourceKey);

    if (localized !== resourceKey) {
        return localized;
    }

    return getMessage('csc.warning.actionsnotallowedduetomissingmetadata');
}

/**
 * Formats a localized CSC message with placeholders.
 *
 * @param {string} key - Resource key in `payonebm.properties`.
 * @returns {string} Localized formatted message.
 */
function getFormattedMessage(key) {
    var args = Array.prototype.slice.call(arguments, 1);

    return Resource.msgf.apply(Resource, [key, 'payonebm', null].concat(args));
}

/**
 * Resolves one PAYONE cancellation-reason enum to its localized CSC label.
 *
 * @param {string} cancellationReason - PAYONE cancellation-reason enum value.
 * @returns {string} Localized label or the raw enum fallback.
 */
function getCancelReasonLabel(cancellationReason) {
    var reasonCode = String(cancellationReason || '');
    var resourceKey = 'csc.cancelreason.' + reasonCode.toLowerCase();
    var localized = getMessage(resourceKey);

    return localized === resourceKey ? reasonCode : localized;
}

/**
 * Returns the localized cancel-reason options exposed in the CSC order tab.
 *
 * @returns {Array} Available cancel-reason options with localized labels.
 */
function getCancelReasonOptions() {
    return CSC_CANCEL_REASONS.map(function (reasonCode) {
        return {
            value: reasonCode,
            label: getCancelReasonLabel(reasonCode)
        };
    });
}

/**
 * Validates whether the submitted cancel reason is supported by the PAYONE contract.
 *
 * @param {string} cancellationReason - Submitted cancel reason value.
 * @returns {boolean} True when the reason is supported.
 */
function isValidCancelReason(cancellationReason) {
    return CSC_CANCEL_REASONS.indexOf(String(cancellationReason || '')) !== -1;
}

/**
 * Converts arbitrary numeric input into a non-negative whole-item quantity.
 *
 * @param {*} quantity - Raw quantity candidate.
 * @returns {number} Normalized integer quantity.
 */
function normalizeQuantity(quantity) {
    var normalized = Number(quantity);

    // eslint-disable-next-line no-restricted-globals
    if (isNaN(normalized) || normalized < 0) {
        return 0;
    }

    return Math.floor(normalized);
}

/**
 * Normalizes one stored CSC item status record into the expected quantity shape.
 *
 * @param {Object} record - Stored item-level status record.
 * @returns {{captured:number, refunded:number, cancelled:number}} Normalized status quantities.
 */
function normalizeItemLevelStatusRecord(record) {
    var safeRecord = record || {};

    return {
        captured: normalizeQuantity(safeRecord.captured || safeRecord.CAPTURED),
        refunded: normalizeQuantity(safeRecord.refunded || safeRecord.REFUNDED),
        cancelled: normalizeQuantity(safeRecord.cancelled || safeRecord.CANCELLED)
    };
}

/**
 * Loads persisted CSC item-level quantities from the order custom attribute.
 *
 * @param {dw.order.Order|Object} order - Order carrying CSC local state.
 * @returns {Object} Map keyed by selection id / line item UUID.
 */
function getStoredItemLevelStatuses(order) {
    var parsed = parseJson(readCustomAttribute(order, ITEM_LEVEL_STATUS_ATTRIBUTE));
    var normalized = {};

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return normalized;
    }

    Object.keys(parsed).forEach(function (key) {
        normalized[String(key)] = normalizeItemLevelStatusRecord(parsed[key]);
    });

    return normalized;
}

/**
 * Saves CSC item-level status quantities back to the order custom attribute.
 *
 * @param {dw.order.Order|Object} order - Order to update.
 * @param {Object} itemLevelStatuses - Persisted CSC item-level status map.
 * @returns {void}
 */
function saveItemLevelStatuses(order, itemLevelStatuses) {
    var payload = {};

    if (!order) {
        return;
    }

    Object.keys(itemLevelStatuses || {}).forEach(function (key) {
        payload[String(key)] = itemLevelStatuses[key];
    });

    Transaction.wrap(function () {
        try {
            order.custom[ITEM_LEVEL_STATUS_ATTRIBUTE] = JSON.stringify(payload);
        } catch (e) {
            // Metadata may not yet be imported in some sandboxes.
        }
    });
}

/**
 * Initializes local item quantities for a direct sale captured before CSC actions begin.
 *
 * @param {dw.order.Order|Object} order - Order carrying CSC local state.
 * @param {Object} commerceCaseResult - Latest PAYONE commerce case response.
 * @param {Object|null} statusSummary - PAYONE-derived CSC status summary.
 * @returns {Object} Existing or initialized item-level status map.
 */
function initializeCapturedSaleItemStatuses(order, commerceCaseResult, statusSummary) {
    var statuses = getStoredItemLevelStatuses(order);
    var checkout;
    var selectionMappings;

    if (!order || Object.keys(statuses).length || !statusSummary ||
        statusSummary.eventType !== 'SALE' || statusSummary.eventPaymentStatus !== 'CAPTURED') {
        return statuses;
    }

    checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    selectionMappings = payoneCSCRequestBuilder.buildCheckoutSelectionMappings(order, checkout);

    selectionMappings.checkoutItems.forEach(function (checkoutItem, checkoutIndex) {
        var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
        var selectionId = selectionMappings.selectionIdByCheckoutIndex[checkoutIndex];
        var orderedQuantity = normalizeQuantity(details.quantity);

        if (!selectionId || orderedQuantity < 1 || payoneCSCRequestBuilder.isInformationalOnlyCheckoutItem(checkoutItem)) {
            return;
        }

        statuses[String(selectionId)] = {
            captured: orderedQuantity,
            refunded: 0,
            cancelled: 0
        };
    });

    if (Object.keys(statuses).length) {
        saveItemLevelStatuses(order, statuses);
    }

    return statuses;
}

/**
 * Checks whether an order-level amount action was already performed for the order.
 *
 * @param {dw.order.Order|Object} order - Order carrying CSC local state.
 * @returns {boolean} True when an order-level amount action was recorded.
 */
function isOrderLevelAmountActionUsed(order) {
    return readCustomAttribute(order, ORDER_AMOUNT_ACTION_USED_ATTRIBUTE) === true;
}

/**
 * Persists the marker that disables future item-level actions after an order-level amount action.
 *
 * @param {dw.order.Order|Object} order - Order to update.
 * @returns {void}
 */
function markOrderLevelAmountActionUsed(order) {
    if (!order) {
        return;
    }

    Transaction.wrap(function () {
        try {
            order.custom[ORDER_AMOUNT_ACTION_USED_ATTRIBUTE] = true;
        } catch (e) {
            // Metadata may not yet be imported in some sandboxes.
        }
    });
}

/**
 * Derives local capturable and refundable quantities for one stored SFCC line item.
 *
 * @param {dw.order.Order|Object} order - Order holding persisted CSC state.
 * @param {dw.order.ProductLineItem|Object} lineItem - SFCC line item matched to the selection.
 * @param {number} orderedQuantity - Ordered quantity for that row.
 * @returns {{orderedQuantity:number, capturedQuantity:number, refundedQuantity:number, cancelledQuantity:number, capturableQuantity:number, refundableQuantity:number}}
 * Local quantity summary.
 */
function getStoredActionQuantities(order, lineItem, orderedQuantity) {
    var statuses = getStoredItemLevelStatuses(order);
    var record = lineItem && lineItem.UUID ? normalizeItemLevelStatusRecord(statuses[lineItem.UUID]) : null;
    var capturedQuantity = record ? record.captured : 0;
    var refundedQuantity = record ? record.refunded : 0;
    var cancelledQuantity = record ? record.cancelled : 0;

    return {
        orderedQuantity: orderedQuantity,
        capturedQuantity: capturedQuantity,
        refundedQuantity: refundedQuantity,
        cancelledQuantity: cancelledQuantity,
        capturableQuantity: Math.max(0, orderedQuantity - capturedQuantity - cancelledQuantity),
        refundableQuantity: Math.max(0, capturedQuantity - refundedQuantity)
    };
}

/**
 * Applies locally tracked item-level capture or refund quantities for selected CSC table rows
 * after a successful PAYONE action.
 *
 * @param {dw.order.Order|Object} order - Order to update.
 * @param {Object} commerceCaseResult - Latest PAYONE commerce case response.
 * @param {Array} selectedItems - Submitted item-table selections from the CSC UI.
 * @param {string} action - Either item-level `capture` or `refund`.
 * @returns {void}
 */
function updateStoredStatusesForSelectedItems(order, commerceCaseResult, selectedItems, action) {
    var statuses = getStoredItemLevelStatuses(order);
    var checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var selectionMappings = payoneCSCRequestBuilder.buildCheckoutSelectionMappings(order, checkout);

    selectedItems.forEach(function (selectedItem) {
        var lineItem = selectionMappings.lineItemBySelectionId[selectedItem.id] || null;
        var checkoutItem = selectionMappings.checkoutItemBySelectionId[selectedItem.id] || null;
        var currentStatus;
        var orderedQuantity;
        var quantityToApply;

        if (!lineItem && !checkoutItem) {
            return;
        }

        currentStatus = normalizeItemLevelStatusRecord(statuses[selectedItem.id]);
        orderedQuantity = lineItem
            ? normalizeQuantity(lineItem.quantityValue)
            : normalizeQuantity(checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails.quantity : 0);
        quantityToApply = Math.min(selectedItem.quantity, action === 'refund'
            ? Math.max(0, currentStatus.captured - currentStatus.refunded)
            : Math.max(0, orderedQuantity - currentStatus.captured - currentStatus.cancelled));

        if (quantityToApply <= 0) {
            return;
        }

        if (action === 'refund') {
            currentStatus.refunded += quantityToApply;
        } else if (action === 'capture') {
            currentStatus.captured += quantityToApply;
        }

        statuses[selectedItem.id] = currentStatus;
    });

    saveItemLevelStatuses(order, statuses);
}

/**
 * Marks every item-level CSC row with remaining uncaptured quantity as cancelled after a
 * successful PAYONE authorization reversal.
 *
 * @param {dw.order.Order|Object} order - Order to update.
 * @param {Object} commerceCaseResult - Latest PAYONE commerce case response.
 * @returns {void}
 */
function updateStoredStatusesForCancel(order, commerceCaseResult) {
    var statuses = getStoredItemLevelStatuses(order);
    var checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var selectionMappings = payoneCSCRequestBuilder.buildCheckoutSelectionMappings(order, checkout);

    selectionMappings.checkoutItems.forEach(function (checkoutItem, checkoutIndex) {
        var selectionId = selectionMappings.selectionIdByCheckoutIndex[checkoutIndex];
        var lineItem = selectionMappings.lineItemBySelectionId[selectionId] || null;
        var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
        var currentStatus = normalizeItemLevelStatusRecord(statuses[selectionId]);
        var orderedQuantity = lineItem
            ? normalizeQuantity(lineItem.quantityValue)
            : normalizeQuantity(details.quantity);
        var cancellableQuantity = Math.max(0, orderedQuantity - currentStatus.captured - currentStatus.cancelled);

        if (cancellableQuantity <= 0) {
            return;
        }

        currentStatus.cancelled += cancellableQuantity;
        statuses[selectionId] = currentStatus;
    });

    saveItemLevelStatuses(order, statuses);
}

/**
 * Resolves the order currency code from the most reliable SFCC source available.
 *
 * @param {dw.order.Order|Object} order - Order to inspect.
 * @param {Object} [checkout] - Optional PAYONE checkout fallback.
 * @returns {string|null} ISO currency code or null.
 */
function getCurrencyCode(order, checkout) {
    if (!order) {
        return checkout && checkout.amountOfMoney ? checkout.amountOfMoney.currencyCode : null;
    }

    return order.currencyCode || (typeof order.getCurrencyCode === 'function' ? order.getCurrencyCode() : null);
}

/**
 * Formats a cent-based amount for CSC display.
 *
 * @param {number} amount - Cent-based amount from PAYONE or local math.
 * @param {string} currencyCode - ISO currency code.
 * @param {string} [productType] - Optional PAYONE product type for display-specific formatting.
 * @returns {string|null} Formatted money string or null when unavailable.
 */
function formatAmount(amount, currencyCode, productType) {
    var displayAmount = Number(amount);
    var formattedAmount;

    if (amount === null || typeof amount === 'undefined' || !currencyCode) {
        return null;
    }

    if (productType === 'DISCOUNT') {
        displayAmount = Math.abs(displayAmount || 0);
    }

    formattedAmount = StringUtils.formatMoney(new Money(displayAmount / 100, currencyCode));

    return productType === 'DISCOUNT' && formattedAmount ? '-' + formattedAmount : formattedAmount;
}

/**
 * Resolves the visible currency symbol used by formatted amounts.
 *
 * @param {string} currencyCode - ISO currency code.
 * @returns {string} Currency symbol fallbacking to the currency code.
 */
function getCurrencySymbol(currencyCode) {
    var zeroFormatted = formatAmount(0, currencyCode);
    var symbol;

    if (!zeroFormatted) {
        return currencyCode || '';
    }

    symbol = zeroFormatted.replace(/[0-9\s,.'\u00A0]/g, '');

    return symbol || currencyCode || '';
}

/**
 * Normalizes PAYONE timestamps so the native JS date parser can consume them reliably.
 *
 * @param {string} dateTime - PAYONE timestamp string.
 * @returns {string|null} Normalized ISO-like value or null.
 */
function normalizePayoneDateTime(dateTime) {
    var value = dateTime ? String(dateTime) : null;
    var match;

    if (!value) {
        return null;
    }

    match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z)?$/);

    if (match) {
        return match[1] + 'T' + match[2] + (match[3] ? '.' + match[3].slice(0, 3) : '') + (match[4] || '');
    }

    return value;
}

/**
 * Formats a PAYONE timestamp for CSC summary rendering.
 *
 * @param {string} dateTime - PAYONE timestamp string.
 * @returns {string|null} Formatted date-time string or the raw input when parsing fails.
 */
function formatDateTime(dateTime) {
    var normalizedValue = normalizePayoneDateTime(dateTime);
    var parsedDate;
    var calendar;

    if (!normalizedValue) {
        return null;
    }

    parsedDate = new Date(normalizedValue);

    // eslint-disable-next-line no-restricted-globals
    if (isNaN(parsedDate.getTime())) {
        return String(dateTime);
    }

    calendar = new Calendar(parsedDate);

    return StringUtils.formatCalendar(calendar, 'dd.MM.yyyy HH:mm:ss');
}

/**
 * Chooses the initial quantity shown in the CSC quantity input for one row.
 *
 * @param {number} capturableQuantity - Currently capturable quantity.
 * @param {number} refundableQuantity - Currently refundable quantity.
 * @returns {number} Initial quantity value.
 */
function getInitialProcessQuantity(capturableQuantity, refundableQuantity) {
    if (capturableQuantity > 0 && refundableQuantity > 0) {
        return Math.min(capturableQuantity, refundableQuantity);
    }

    return Math.max(capturableQuantity, refundableQuantity);
}

/**
 * Returns the order product line items as a plain array.
 *
 * @param {dw.order.Order|Object} order - Order to inspect.
 * @returns {Array} Product line items in SFCC order.
 */
function getProductLineItems(order) {
    if (!order) {
        return [];
    }

    if (typeof order.getProductLineItems === 'function') {
        return toArray(order.getProductLineItems());
    }

    return toArray(order.productLineItems);
}

/**
 * Selects the payment instrument that stores PAYONE transaction identifiers.
 *
 * @param {dw.order.Order|Object} order - Order containing payment instruments.
 * @returns {dw.order.PaymentInstrument|Object|null} Relevant PAYONE payment instrument.
 */
function getRelevantPaymentInstrument(order) {
    var instruments = toArray(order && (typeof order.getPaymentInstruments === 'function' ? order.getPaymentInstruments() : order.paymentInstruments));
    var i;
    var instrument;

    for (i = 0; i < instruments.length; i += 1) {
        instrument = instruments[i];

        if (readCustomAttribute(instrument && instrument.paymentTransaction, 'payoneCommerceCaseId')) {
            return instrument;
        }
    }

    return null;
}

/**
 * Reads the PAYONE identifiers stored on the payment transaction.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument carrying PAYONE custom attributes.
 * @returns {{commerceCaseId:string, checkoutId:string, paymentExecutionId:(string|null)}|null} Identifiers or null when the checkout identifiers are incomplete.
 */
function getIdentifiers(paymentInstrument) {
    var transaction = paymentInstrument && paymentInstrument.paymentTransaction;
    var identifiers = {
        commerceCaseId: readCustomAttribute(transaction, 'payoneCommerceCaseId'),
        checkoutId: readCustomAttribute(transaction, 'payoneCheckoutId'),
        paymentExecutionId: readCustomAttribute(transaction, 'payonePaymentExecutionId')
    };

    if (!identifiers.commerceCaseId || !identifiers.checkoutId) {
        return null;
    }

    return identifiers;
}

/**
 * Indicates whether the CSC can execute payment-execution actions for the given identifiers.
 *
 * @param {Object|null} identifiers - PAYONE identifiers from the payment transaction.
 * @returns {boolean} True when a payment execution id is available.
 */
function hasActionableIdentifiers(identifiers) {
    return !!(identifiers && identifiers.commerceCaseId && identifiers.checkoutId && identifiers.paymentExecutionId);
}

/**
 * Saves the latest PAYONE checkout-level and payment-event statuses on the SFCC payment transaction.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument to update.
 * @param {string|null} checkoutPaymentStatus - PAYONE checkout-level payment status.
 * @param {string|null} latestPaymentEventStatus - Latest PAYONE payment-event status.
 * @returns {void}
 */
function savePaymentStatuses(paymentInstrument, checkoutPaymentStatus, latestPaymentEventStatus) {
    if (!paymentInstrument || !paymentInstrument.paymentTransaction) {
        return;
    }

    Transaction.wrap(function () {
        try {
            paymentInstrument.paymentTransaction.custom.payoneCheckoutPaymentStatus = checkoutPaymentStatus || null;
            paymentInstrument.paymentTransaction.custom.payoneLatestPaymentEventStatus = latestPaymentEventStatus || null;
        } catch (e) {
            // Metadata may not yet be imported in some sandboxes.
        }
    });
}

/**
 * Parses the serialized CSC selection payload posted from the UI.
 *
 * @param {string} selectedItemsPayload - Serialized JSON array of selected CSC rows.
 * @returns {Array} Sanitized selection array with ids and integer quantities.
 */
function parseSelectedItems(selectedItemsPayload) {
    var parsed = parseJson(selectedItemsPayload);

    if (!parsed || !Array.isArray(parsed)) {
        return [];
    }

    return parsed.map(function (item) {
        var quantity = Number(item && item.quantity);

        return {
            id: item && item.id ? String(item.id) : null,
            quantity: quantity > 0 ? Math.floor(quantity) : 0
        };
    }).filter(function (item) {
        return !!(item.id && item.quantity > 0);
    });
}

/**
 * Parses a decimal amount string into PAYONE minor units for order-level actions.
 *
 * @param {string} orderAmountPayload - User-entered decimal amount text.
 * @returns {number|null} Minor-unit amount or null when invalid.
 */
function parseOrderAmount(orderAmountPayload) {
    var normalizedText;
    var parsedAmount;

    if (orderAmountPayload === null || typeof orderAmountPayload === 'undefined') {
        return null;
    }

    normalizedText = String(orderAmountPayload).trim().replace(',', '.');

    if (!normalizedText || !/^\d+(?:\.\d{1,2})?$/.test(normalizedText)) {
        return null;
    }

    parsedAmount = Math.round(Number(normalizedText) * 100);

    return parsedAmount > 0 ? parsedAmount : null;
}

/**
 * Chooses the most useful timestamp for the current checkout event summary.
 *
 * @param {Object} lastEvent - Latest PAYONE payment execution event.
 * @param {Object} paymentExecution - PAYONE payment execution object.
 * @param {Object} checkout - PAYONE checkout object.
 * @returns {string|null} Raw timestamp string for display formatting.
 */
function getEventDate(lastEvent, paymentExecution, checkout) {
    if (lastEvent && lastEvent.creationDateTime) {
        return lastEvent.creationDateTime;
    }

    if (paymentExecution && paymentExecution.lastUpdated) {
        return paymentExecution.lastUpdated;
    }

    if (paymentExecution && paymentExecution.creationDateTime) {
        return paymentExecution.creationDateTime;
    }

    if (checkout && checkout.creationDateTime) {
        return checkout.creationDateTime;
    }

    return null;
}

/**
 * Derives the CSC status summary and action availability from the PAYONE commerce case.
 *
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @returns {Object|null} CSC summary view model or null when no checkout is available.
 */
function getStatusSummary(commerceCaseResult) {
    var checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var paymentExecution = checkout
        ? (checkout.paymentExecution || (checkout.paymentExecutions && checkout.paymentExecutions[0]))
        : null;
    var events = toArray(paymentExecution && paymentExecution.events);
    var lastEvent = events && events.length ? events[events.length - 1] : null;
    var statusOutput = checkout && checkout.statusOutput;
    var paymentResponse = checkout && checkout.paymentResponse;
    var payment = paymentResponse && paymentResponse.payment;
    var paymentStatusOutput = payment && payment.statusOutput;
    var errorResponse = checkout && checkout.errorResponse;
    var errors = toArray(errorResponse && errorResponse.errors);
    var firstError = errors.length ? errors[0] : null;
    var allowedPaymentActions = toArray(checkout && checkout.allowedPaymentActions);
    var hasPaymentExecutionAccess = allowedPaymentActions.indexOf('PAYMENT_EXECUTION') > -1;
    var collectedAmount = statusOutput ? Number(statusOutput.collectedAmount) || 0 : 0;
    var refundedAmount = statusOutput ? Number(statusOutput.refundedAmount) || 0 : 0;
    var cancelledAmount = statusOutput ? Number(statusOutput.cancelledAmount) || 0 : 0;
    var openAmount = statusOutput ? Number(statusOutput.openAmount) || 0 : 0;
    var isRejected;
    var paymentStatus = statusOutput ? statusOutput.paymentStatus : null;
    var isPreCompletionStatus = paymentStatus === 'PAYMENT_NOT_COMPLETED' || paymentStatus === 'WAITING_FOR_PAYMENT';
    var currencyCode = checkout && checkout.amountOfMoney ? checkout.amountOfMoney.currencyCode : null;
    var eventType;
    var eventPaymentStatus;
    var eventCancellationReason;
    var hasAuthorizedFlag = paymentStatusOutput && typeof paymentStatusOutput.isAuthorized === 'boolean';
    var hasCancellableFlag = paymentStatusOutput && typeof paymentStatusOutput.isCancellable === 'boolean';
    var isAuthorized = hasAuthorizedFlag ? paymentStatusOutput.isAuthorized === true : false;
    var isCancellable = hasCancellableFlag ? paymentStatusOutput.isCancellable === true : false;
    var isRefundable = paymentStatusOutput ? paymentStatusOutput.isRefundable === true : false;
    var isReservationPendingCapture;
    var hasCapturedState;
    var hasRefundedState;
    var hasCancelledState;
    var canOperateOnAuthorization;
    var eventDate;

    if (!lastEvent && firstError) {
        lastEvent = {
            type: firstError.id || firstError.errorCode || 'ERROR',
            paymentStatus: firstError.message || firstError.category || 'REJECTED',
            creationDateTime: paymentExecution && paymentExecution.lastUpdated
                ? paymentExecution.lastUpdated
                : (checkout.creationDateTime || null)
        };
    }

    if (!lastEvent && payment) {
        lastEvent = {
            type: payment.status || null,
            paymentStatus: payment.status || (payment.statusOutput && payment.statusOutput.statusCategory) || null,
            creationDateTime: paymentExecution && paymentExecution.lastUpdated
                ? paymentExecution.lastUpdated
                : (checkout.creationDateTime || null)
        };
    }

    if (!checkout) {
        return null;
    }

    eventType = lastEvent ? lastEvent.type : null;
    eventPaymentStatus = lastEvent ? lastEvent.paymentStatus : null;
    eventCancellationReason = lastEvent && lastEvent.cancellationReason ? String(lastEvent.cancellationReason) : null;
    eventDate = getEventDate(lastEvent, paymentExecution, checkout);
    isRejected = eventPaymentStatus === 'REJECTED' || !!firstError;
    isReservationPendingCapture = eventType === 'RESERVATION' && eventPaymentStatus === 'PENDING_CAPTURE';

    if (!hasAuthorizedFlag) {
        isAuthorized = isReservationPendingCapture;
    }

    if (!hasCancellableFlag) {
        isCancellable = isReservationPendingCapture;
    }

    hasCapturedState = eventType === 'CAPTURE' || collectedAmount > 0;
    hasRefundedState = eventType === 'REFUND' || refundedAmount > 0;
    hasCancelledState = eventType === 'REVERSAL' || eventPaymentStatus === 'CANCELLED' || cancelledAmount > 0;
    canOperateOnAuthorization = hasPaymentExecutionAccess && !isRejected && !hasCapturedState && !hasRefundedState &&
        !hasCancelledState && isPreCompletionStatus && (isReservationPendingCapture || isAuthorized);

    return {
        checkoutStatus: checkout.checkoutStatus || null,
        paymentStatus: paymentStatus,
        eventType: lastEvent ? lastEvent.type : null,
        eventPaymentStatus: lastEvent ? lastEvent.paymentStatus : null,
        cancellationReason: eventCancellationReason,
        eventDate: formatDateTime(eventDate),
        eventLabel: lastEvent
            ? [lastEvent.type, lastEvent.paymentStatus].filter(function (value) {
                return !!value;
            }).join(' ')
            : null,
        allowedPaymentActions: allowedPaymentActions,
        allowedPaymentActionsText: allowedPaymentActions.length ? allowedPaymentActions.join(', ') : null,
        collectedAmount: collectedAmount,
        collectedAmountFormatted: formatAmount(collectedAmount, currencyCode),
        refundedAmount: refundedAmount,
        refundedAmountFormatted: formatAmount(refundedAmount, currencyCode),
        cancelledAmount: cancelledAmount,
        cancelledAmountFormatted: formatAmount(cancelledAmount, currencyCode),
        openAmount: openAmount,
        openAmountFormatted: formatAmount(openAmount, currencyCode),
        errorCode: firstError ? (firstError.errorCode || null) : null,
        errorMessage: firstError ? (firstError.message || null) : null,
        canCapture: !!(hasPaymentExecutionAccess && !isRejected && !hasCancelledState && openAmount > 0),
        canRefund: !!(hasPaymentExecutionAccess && !isRejected && !hasCancelledState && (collectedAmount > 0 || isRefundable)),
        canCancel: !!(canOperateOnAuthorization && isCancellable)
    };
}

/**
 * Builds the order-level view data used by the free-form amount operations tab.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {Object|null} statusSummary - PAYONE-derived CSC status summary.
 * @returns {Object} Order-level view data with display amounts and action availability.
 */
function buildOrderLevelViewData(order, commerceCaseResult, statusSummary) {
    var checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var currencyCode = getCurrencyCode(order) || getCurrencyCode(null, checkout);
    var totalAmount = checkout && checkout.amountOfMoney ? Number(checkout.amountOfMoney.amount) || 0 : 0;
    var openAmount = statusSummary ? Number(statusSummary.openAmount) || 0 : 0;
    var cancelledAmount = statusSummary ? Number(statusSummary.cancelledAmount) || 0 : 0;
    var refundedAmount = statusSummary ? Number(statusSummary.refundedAmount) || 0 : 0;
    var collectedAmount = statusSummary ? Number(statusSummary.collectedAmount) || 0 : 0;
    var capturedAmount = collectedAmount + refundedAmount;

    return {
        currencySymbol: getCurrencySymbol(currencyCode),
        totalAmount: totalAmount,
        totalAmountFormatted: formatAmount(totalAmount, currencyCode),
        capturedAmount: capturedAmount,
        capturedAmountFormatted: formatAmount(capturedAmount, currencyCode),
        refundedAmount: refundedAmount,
        refundedAmountFormatted: formatAmount(refundedAmount, currencyCode),
        collectedAmount: collectedAmount,
        collectedAmountFormatted: formatAmount(collectedAmount, currencyCode),
        cancelledAmount: cancelledAmount,
        cancelledAmountFormatted: formatAmount(cancelledAmount, currencyCode),
        capturableAmount: openAmount,
        capturableAmountFormatted: formatAmount(openAmount, currencyCode),
        refundableAmount: collectedAmount,
        refundableAmountFormatted: formatAmount(collectedAmount, currencyCode),
        canCapture: !!(statusSummary && statusSummary.canCapture && openAmount > 0),
        canRefund: !!(statusSummary && statusSummary.canRefund && collectedAmount > 0)
    };
}

/**
 * Resolves the warning message shown when item-level actions are disabled.
 *
 * @param {boolean} itemLevelTrackingAvailable - Whether CSC metadata is installed.
 * @param {boolean} hasOrderLevelDiscount - Whether the checkout contains discount rows.
 * @param {boolean} orderLevelAmountActionUsed - Whether an order-level amount action was already used.
 * @returns {string|null} Warning message or null when item-level actions remain available.
 */
function getItemLevelActionsDisabledMessage(itemLevelTrackingAvailable, hasOrderLevelDiscount, orderLevelAmountActionUsed) {
    if (!itemLevelTrackingAvailable) {
        return getMessage('csc.warning.actionsnotallowedduetomissingmetadata');
    }

    if (orderLevelAmountActionUsed) {
        return getMessage('csc.warning.itemleveldisabledafterorderaction');
    }

    if (hasOrderLevelDiscount) {
        return getMessage('csc.warning.itemleveldisabledduetodiscount');
    }

    return null;
}

/**
 * Resolves the no-actions message based on the current PAYONE-derived summary.
 *
 * @param {Object|null} statusSummary - CSC status summary.
 * @param {Object|null} identifiers - PAYONE identifiers from the payment transaction.
 * @returns {string} User-facing no-actions message.
 */
function getNoActionsMessage(statusSummary, identifiers) {
    var isCancelledAuthorizationState;

    if (identifiers && !identifiers.paymentExecutionId) {
        return getMessage('csc.actions.none.checkoutonly');
    }

    if (!statusSummary) {
        return getMessage('csc.actions.none');
    }

    isCancelledAuthorizationState = statusSummary.paymentStatus === 'WAITING_FOR_PAYMENT' &&
        Number(statusSummary.cancelledAmount) > 0 &&
        Number(statusSummary.collectedAmount) === 0 &&
        Number(statusSummary.refundedAmount) === 0;

    if (isCancelledAuthorizationState) {
        return getMessage('csc.actions.none.cancelledauthorization');
    }

    return getMessage('csc.actions.none');
}

/**
 * Builds fallback CSC row models from SFCC line items when checkout items are unavailable.
 *
 * @param {dw.order.Order|Object} order - Order to render.
 * @returns {Array} CSC item row view models.
 */
function buildFallbackItemViewModels(order) {
    var currencyCode = getCurrencyCode(order);

    return getProductLineItems(order).map(function (lineItem) {
        var item = new CartItemInput(lineItem).toOrderUpdate();
        var details = item.orderLineDetails || {};
        var productType = details.productType || 'GOODS';
        var quantity = normalizeQuantity(details.quantity);
        var quantities = getStoredActionQuantities(order, lineItem, quantity);
        var capturedQuantity = normalizeQuantity(quantities.capturedQuantity);
        var refundedQuantity = normalizeQuantity(quantities.refundedQuantity);
        var capturableQuantity = normalizeQuantity(quantities.capturableQuantity);
        var refundableQuantity = normalizeQuantity(quantities.refundableQuantity);
        var unitAmount = Number(details.productPrice) || 0;
        var totalAmount = unitAmount * quantity;
        var capturedAmount = unitAmount * capturedQuantity;
        var refundedAmount = unitAmount * refundedQuantity;
        var collectedAmount = capturedAmount - refundedAmount;
        var initialProcessQuantity = getInitialProcessQuantity(capturableQuantity, refundableQuantity);
        var maxProcessQuantity = Math.max(capturableQuantity, refundableQuantity);
        var isDiscountItem = productType === 'DISCOUNT';

        return {
            id: lineItem.UUID || details.id,
            productCode: productType === 'DISCOUNT' ? productType : (details.productCode || ''),
            productType: productType,
            amountCellClass: isDiscountItem ? 'payone-csc-discount-amount' : '',
            isInformationalOnly: payoneCSCRequestBuilder.isInformationalOnlyCheckoutItem(item),
            description: item.invoiceData && item.invoiceData.description
                ? item.invoiceData.description
                : (lineItem.productName || lineItem.lineItemText || ''),
            quantity: quantity,
            capturedQuantity: capturedQuantity,
            refundedQuantity: refundedQuantity,
            capturableQuantity: capturableQuantity,
            refundableQuantity: refundableQuantity,
            capturedQuantityDisplay: String(capturedQuantity),
            refundedQuantityDisplay: String(refundedQuantity),
            capturedAmount: formatAmount(capturedAmount, currencyCode),
            refundedAmount: formatAmount(refundedAmount, currencyCode),
            collectedAmount: formatAmount(collectedAmount, currencyCode),
            initialProcessQuantity: initialProcessQuantity,
            maxProcessQuantity: maxProcessQuantity,
            quantityDisplay: String(quantity),
            defaultProcessQuantity: maxProcessQuantity > 0 ? '1' : '0',
            unitAmount: formatAmount(unitAmount, currencyCode, productType),
            totalAmount: formatAmount(totalAmount, currencyCode, productType)
        };
    });
}

/**
 * Builds the CSC item table rows from PAYONE checkout items plus local item tracking.
 *
 * @param {dw.order.Order|Object} order - SFCC order to render.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @returns {Array} CSC item row view models.
 */
function buildItemViewModels(order, commerceCaseResult) {
    var checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var selectionMappings = payoneCSCRequestBuilder.buildCheckoutSelectionMappings(order, checkout);
    var checkoutItems = selectionMappings.checkoutItems;
    var currencyCode = getCurrencyCode(order);
    var itemModels;

    if (!checkoutItems.length) {
        return buildFallbackItemViewModels(order);
    }

    itemModels = checkoutItems.map(function (item, checkoutIndex) {
        var details = item && item.orderLineDetails ? item.orderLineDetails : {};
        var productType = details.productType || 'GOODS';
        var productCode = details.productCode || '';
        var selectionId = selectionMappings.selectionIdByCheckoutIndex[checkoutIndex];
        var lineItem = selectionMappings.lineItemBySelectionId[selectionId] || null;
        var quantity = normalizeQuantity(details.quantity);
        var unitAmount = Number(details.productPrice) || 0;
        var description;
        var quantities;
        var capturedQuantity;
        var refundedQuantity;
        var capturableQuantity;
        var refundableQuantity;
        var initialProcessQuantity;
        var maxProcessQuantity;
        var capturedAmount;
        var refundedAmount;
        var collectedAmount;
        var isDiscountItem = productType === 'DISCOUNT';
        quantities = lineItem
            ? getStoredActionQuantities(order, lineItem, quantity)
            : payoneCSCRequestBuilder.getLocalRowQuantities(item, getStoredItemLevelStatuses(order), selectionId);
        capturedQuantity = normalizeQuantity(quantities.capturedQuantity);
        refundedQuantity = normalizeQuantity(quantities.refundedQuantity);
        capturableQuantity = normalizeQuantity(quantities.capturableQuantity);
        refundableQuantity = normalizeQuantity(quantities.refundableQuantity);
        initialProcessQuantity = getInitialProcessQuantity(capturableQuantity, refundableQuantity);
        maxProcessQuantity = Math.max(capturableQuantity, refundableQuantity);
        capturedAmount = unitAmount * capturedQuantity;
        refundedAmount = unitAmount * refundedQuantity;
        collectedAmount = capturedAmount - refundedAmount;
        description = productType;

        if (lineItem && (lineItem.productName || lineItem.lineItemText)) {
            description = lineItem.productName || lineItem.lineItemText;
        }

        if (item.invoiceData && item.invoiceData.description) {
            description = item.invoiceData.description;
        }

        return {
            id: selectionId,
            productCode: productType === 'DISCOUNT' ? productType : (productCode || productType),
            productType: productType,
            amountCellClass: isDiscountItem ? 'payone-csc-discount-amount' : '',
            isInformationalOnly: payoneCSCRequestBuilder.isInformationalOnlyCheckoutItem(item),
            description: description,
            quantity: quantity,
            capturedQuantity: capturedQuantity,
            refundedQuantity: refundedQuantity,
            capturableQuantity: capturableQuantity,
            refundableQuantity: refundableQuantity,
            capturedQuantityDisplay: String(capturedQuantity),
            refundedQuantityDisplay: String(refundedQuantity),
            capturedAmount: formatAmount(capturedAmount, currencyCode),
            refundedAmount: formatAmount(refundedAmount, currencyCode),
            collectedAmount: formatAmount(collectedAmount, currencyCode),
            initialProcessQuantity: initialProcessQuantity,
            maxProcessQuantity: maxProcessQuantity,
            quantityDisplay: String(quantity),
            defaultProcessQuantity: maxProcessQuantity > 0 ? '1' : '0',
            unitAmount: formatAmount(unitAmount, currencyCode, productType),
            totalAmount: formatAmount(unitAmount * quantity, currencyCode, productType)
        };
    });

    return itemModels;
}

/**
 * Applies the display state for item-level status cells in the CSC table.
 *
 * @param {Array} items - Item row view models.
 * @param {boolean} orderLevelAmountActionUsed - Whether order-level amount actions were used.
 * @param {boolean} hasOrderLevelDiscount - Whether the checkout contains an order-level discount line.
 * @returns {Array} Decorated item row view models for template rendering.
 */
function applyItemStatusCellDisplay(items, orderLevelAmountActionUsed, hasOrderLevelDiscount) {
    var staleTooltip = getMessage('csc.items.staledatatooltip');

    return items.map(function (item) {
        var decoratedItem = Object.assign({}, item);

        decoratedItem.statusCellClass = '';
        decoratedItem.statusCellTitle = '';
        decoratedItem.capturedQuantityTableValue = item.capturedQuantityDisplay;
        decoratedItem.refundedQuantityTableValue = item.refundedQuantityDisplay;
        decoratedItem.capturedAmountTableValue = item.capturedAmount;
        decoratedItem.refundedAmountTableValue = item.refundedAmount;
        decoratedItem.collectedAmountTableValue = item.collectedAmount;

        if (hasOrderLevelDiscount) {
            decoratedItem.statusCellClass = 'payone-csc-unavailable-value';
            decoratedItem.capturedQuantityTableValue = 'N/A';
            decoratedItem.refundedQuantityTableValue = 'N/A';
            decoratedItem.capturedAmountTableValue = 'N/A';
            decoratedItem.refundedAmountTableValue = 'N/A';
            decoratedItem.collectedAmountTableValue = 'N/A';

            return decoratedItem;
        }

        if (orderLevelAmountActionUsed) {
            decoratedItem.statusCellClass = 'payone-csc-stale-value';
            decoratedItem.statusCellTitle = staleTooltip || '';
        }

        return decoratedItem;
    });
}

/**
 * Maps a normalized PAYONE action result into the user-facing flash message.
 *
 * @param {Object|null} result - Normalized PAYONE service result.
 * @returns {string} Localized success or error message.
 */
function getActionMessage(result) {
    if (!result) {
        return getMessage('csc.action.failed');
    }

    if (result.ok) {
        return getMessage('csc.action.success');
    }

    return result.userMessage || getMessage('csc.action.failed');
}

/**
 * Executes one CSC action against PAYONE and updates local CSC tracking on success.
 *
 * @param {string} orderNo - SFCC order number.
 * @param {string} action - Requested CSC action (`capture`, `refund`, or `cancel`).
 * @param {string} selectedItemsPayload - Serialized selected item payload from the UI.
 * @param {string} actionScope - Requested action scope (`item` or `order`).
 * @param {string} orderAmountPayload - Free-form amount text for order-level actions.
 * @param {string} cancellationReason - Submitted cancel reason for authorization reversal.
 * @returns {Object} CSC action outcome.
 */
function executeAction(orderNo, action, selectedItemsPayload, actionScope, orderAmountPayload, cancellationReason) {
    var order = OrderMgr.getOrder(orderNo);
    var paymentInstrument = getRelevantPaymentInstrument(order);
    var identifiers = getIdentifiers(paymentInstrument);
    var actionableIdentifiers = hasActionableIdentifiers(identifiers);
    var commerceCaseResult = identifiers ? commerceCaseService.get(identifiers.commerceCaseId, {}) : null;
    var scope = actionScope === 'order' ? 'order' : 'item';
    var selectedItems = parseSelectedItems(selectedItemsPayload);
    var orderAmount = parseOrderAmount(orderAmountPayload);
    var itemLevelTrackingAvailable = hasCustomAttribute(order, ITEM_LEVEL_STATUS_ATTRIBUTE);
    var orderLevelTrackingAvailable = hasCustomAttribute(order, ORDER_AMOUNT_ACTION_USED_ATTRIBUTE);
    var orderLevelAmountActionUsed = isOrderLevelAmountActionUsed(order);
    var itemLevelStatuses;
    var statusSummary = getStatusSummary(commerceCaseResult);
    var hasOrderLevelDiscount = payoneCSCRequestBuilder.hasOrderLevelDiscount(
        payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult)
    );
    var itemLevelActionsDisabledMessage = getItemLevelActionsDisabledMessage(
        itemLevelTrackingAvailable,
        hasOrderLevelDiscount,
        orderLevelAmountActionUsed
    );
    var orderLevelViewData = buildOrderLevelViewData(order, commerceCaseResult, statusSummary);
    var requestBody;
    var result;
    var refreshedStatus;

    itemLevelStatuses = scope === 'item' && itemLevelTrackingAvailable && !orderLevelAmountActionUsed && !hasOrderLevelDiscount
        ? initializeCapturedSaleItemStatuses(order, commerceCaseResult, statusSummary)
        : getStoredItemLevelStatuses(order);

    if (!order) {
        return {
            error: true,
            message: getMessage('csc.error.ordernotfound'),
            result: null
        };
    }

    if (!paymentInstrument || !identifiers) {
        return {
            error: true,
            message: getMessage('csc.error.identifiersmissing'),
            result: null
        };
    }

    if (!actionableIdentifiers) {
        return {
            error: true,
            message: getMessage('csc.error.paymentexecutionnotavailable'),
            result: null
        };
    }

    if (!commerceCaseResult || !commerceCaseResult.ok) {
        return {
            error: true,
            message: getMessage('csc.action.failed'),
            result: null
        };
    }

    if (scope === 'item' && !itemLevelTrackingAvailable) {
        return {
            error: true,
            message: getItemLevelMetadataWarning(),
            result: null
        };
    }

    if (scope === 'order' && (action === 'capture' || action === 'refund') && !orderLevelTrackingAvailable) {
        return {
            error: true,
            message: getMessage('csc.warning.orderlevelactionsnotallowedduetomissingmetadata'),
            result: null
        };
    }

    if ((action === 'capture' && (!statusSummary || !statusSummary.canCapture)) ||
        (action === 'refund' && (!statusSummary || !statusSummary.canRefund)) ||
        (action === 'cancel' && (!statusSummary || !statusSummary.canCancel))) {
        return {
            error: true,
            message: getMessage('csc.error.unsupportedaction'),
            result: null
        };
    }

    if (scope === 'item' && (action === 'capture' || action === 'refund') && itemLevelActionsDisabledMessage) {
        return {
            error: true,
            message: itemLevelActionsDisabledMessage,
            result: null
        };
    }

    if (scope === 'item' && (action === 'capture' || action === 'refund') && !selectedItems.length) {
        return {
            error: true,
            message: getMessage('csc.error.selectitems'),
            result: null
        };
    }

    if (scope === 'item' && (action === 'capture' || action === 'refund') &&
        payoneCSCRequestBuilder.hasInvalidSelectedRowQuantities(order, commerceCaseResult, selectedItems, action, itemLevelStatuses)
    ) {
        return {
            error: true,
            message: getMessage('csc.error.invalidquantity'),
            result: null
        };
    }

    if (scope === 'order' && (action === 'capture' || action === 'refund')) {
        if (!orderAmount) {
            return {
                error: true,
                message: getMessage('csc.error.invalidamount'),
                result: null
            };
        }

        if (action === 'capture' && (!orderLevelViewData.canCapture || orderAmount > orderLevelViewData.capturableAmount)) {
            return {
                error: true,
                message: getFormattedMessage('csc.error.amountmax', 'capture', orderLevelViewData.capturableAmountFormatted),
                result: null
            };
        }

        if (action === 'refund' && (!orderLevelViewData.canRefund || orderAmount > orderLevelViewData.refundableAmount)) {
            return {
                error: true,
                message: getFormattedMessage('csc.error.amountmax', 'refund', orderLevelViewData.refundableAmountFormatted),
                result: null
            };
        }
    }

    if (action === 'cancel' && !isValidCancelReason(cancellationReason)) {
        return {
            error: true,
            message: getMessage('csc.error.invalidcancelreason'),
            result: null
        };
    }

    if (action === 'capture' && scope === 'item') {
        requestBody = payoneCSCRequestBuilder.buildCaptureRequest(order, commerceCaseResult, selectedItems, itemLevelStatuses);
        if (!requestBody) {
            return {
                error: true,
                message: getMessage('csc.action.failed'),
                result: null
            };
        }
        result = paymentExecutionService.capture({
            commerceCaseId: identifiers.commerceCaseId,
            checkoutId: identifiers.checkoutId,
            paymentExecutionId: identifiers.paymentExecutionId,
            body: requestBody
        });
    } else if (action === 'capture' && scope === 'order') {
        requestBody = payoneCSCRequestBuilder.buildOrderLevelCaptureRequest(order, commerceCaseResult, orderAmount);
        if (!requestBody) {
            return {
                error: true,
                message: getMessage('csc.action.failed'),
                result: null
            };
        }
        result = paymentExecutionService.capture({
            commerceCaseId: identifiers.commerceCaseId,
            checkoutId: identifiers.checkoutId,
            paymentExecutionId: identifiers.paymentExecutionId,
            body: requestBody
        });
    } else if (action === 'refund' && scope === 'item') {
        requestBody = payoneCSCRequestBuilder.buildRefundRequest(order, commerceCaseResult, selectedItems, CSC_RETURN_REASON, itemLevelStatuses);
        if (!requestBody) {
            return {
                error: true,
                message: getMessage('csc.action.failed'),
                result: null
            };
        }
        result = paymentExecutionService.refund({
            commerceCaseId: identifiers.commerceCaseId,
            checkoutId: identifiers.checkoutId,
            paymentExecutionId: identifiers.paymentExecutionId,
            body: requestBody
        });
    } else if (action === 'refund' && scope === 'order') {
        requestBody = payoneCSCRequestBuilder.buildOrderLevelRefundRequest(order, commerceCaseResult, orderAmount, CSC_RETURN_REASON);
        if (!requestBody) {
            return {
                error: true,
                message: getMessage('csc.action.failed'),
                result: null
            };
        }
        result = paymentExecutionService.refund({
            commerceCaseId: identifiers.commerceCaseId,
            checkoutId: identifiers.checkoutId,
            paymentExecutionId: identifiers.paymentExecutionId,
            body: requestBody
        });
    } else if (action === 'cancel') {
        requestBody = payoneCSCRequestBuilder.buildCancelRequest(cancellationReason);
        if (!requestBody) {
            return {
                error: true,
                message: getMessage('csc.action.failed'),
                result: null
            };
        }
        result = paymentExecutionService.cancel({
            commerceCaseId: identifiers.commerceCaseId,
            checkoutId: identifiers.checkoutId,
            paymentExecutionId: identifiers.paymentExecutionId,
            body: requestBody
        });
    } else {
        return {
            error: true,
            message: getMessage('csc.error.unsupportedaction'),
            result: null
        };
    }

    if (result && result.ok) {
        if (scope === 'item' && (action === 'capture' || action === 'refund')) {
            updateStoredStatusesForSelectedItems(order, commerceCaseResult, selectedItems, action);
        } else if (scope === 'order' && (action === 'capture' || action === 'refund')) {
            markOrderLevelAmountActionUsed(order);
        } else if (action === 'cancel') {
            updateStoredStatusesForCancel(order, commerceCaseResult);
        }

        refreshedStatus = commerceCaseService.get(identifiers.commerceCaseId, {});
        refreshedStatus = getStatusSummary(refreshedStatus);
        if (refreshedStatus) {
            savePaymentStatuses(paymentInstrument, refreshedStatus.paymentStatus, refreshedStatus.eventPaymentStatus);
        }
    }

    return {
        error: !result || !result.ok,
        message: getActionMessage(result),
        result: result || null
    };
}

/**
 * Builds the full CSC template view model for one order.
 *
 * @param {string} orderNo - SFCC order number.
 * @param {Object|null} actionResult - Optional CSC action result to display after submit.
 * @param {string} activeTabScope - Preferred active tab scope after a postback.
 * @param {string} selectedCancelReason - Cancel reason to keep selected in the CSC order tab.
 * @returns {Object} Template data for the CSC ISML view.
 */
function buildViewData(orderNo, actionResult, activeTabScope, selectedCancelReason) {
    var order = OrderMgr.getOrder(orderNo);
    var paymentInstrument = getRelevantPaymentInstrument(order);
    var identifiers = getIdentifiers(paymentInstrument);
    var actionableIdentifiers = hasActionableIdentifiers(identifiers);
    var commerceCaseResult = identifiers ? commerceCaseService.get(identifiers.commerceCaseId, {}) : null;
    var itemLevelTrackingAvailable = hasCustomAttribute(order, ITEM_LEVEL_STATUS_ATTRIBUTE);
    var orderLevelTrackingAvailable = hasCustomAttribute(order, ORDER_AMOUNT_ACTION_USED_ATTRIBUTE);
    var orderLevelAmountActionUsed = isOrderLevelAmountActionUsed(order);
    var statusSummary;
    var orderLevelViewData;
    var items;
    var itemLevelActionsDisabledMessage;
    var hasOrderLevelDiscount;
    var itemLevelActionsAvailable;
    var orderLevelActionsAvailable;
    var orderTabAvailable;
    var canCancel;
    var itemLevelCanCapture;
    var itemLevelCanRefund;
    var orderLevelCanCapture;
    var orderLevelCanRefund;
    var showOperationTabs;
    var resolvedActiveTab;
    var itemLevelTrackingWarning;
    var orderLevelTrackingWarning;
    var cancelReasonOptions = getCancelReasonOptions();
    var resolvedCancelReason = isValidCancelReason(selectedCancelReason) ? selectedCancelReason : '';
    var errorMessage = '';
    var isPayoneAssociatedPayment = true;
    var checkout;
    var merchantReference;

    statusSummary = getStatusSummary(commerceCaseResult);
    checkout = payoneCSCRequestBuilder.getCheckoutFromCommerceCaseResult(commerceCaseResult);
    merchantReference = checkout && checkout.references
        ? checkout.references.merchantReference
        : null;
    hasOrderLevelDiscount = payoneCSCRequestBuilder.hasOrderLevelDiscount(
        checkout
    );
    if (itemLevelTrackingAvailable && !orderLevelAmountActionUsed && !hasOrderLevelDiscount) {
        initializeCapturedSaleItemStatuses(order, commerceCaseResult, statusSummary);
    }
    orderLevelViewData = buildOrderLevelViewData(order, commerceCaseResult, statusSummary);
    itemLevelActionsDisabledMessage = getItemLevelActionsDisabledMessage(
        itemLevelTrackingAvailable,
        hasOrderLevelDiscount,
        orderLevelAmountActionUsed
    );
    itemLevelActionsAvailable = itemLevelTrackingAvailable && !itemLevelActionsDisabledMessage;
    orderLevelActionsAvailable = orderLevelTrackingAvailable;
    items = order ? buildItemViewModels(order, commerceCaseResult) : [];
    items = applyItemStatusCellDisplay(items, orderLevelAmountActionUsed, hasOrderLevelDiscount);
    itemLevelTrackingWarning = !itemLevelTrackingAvailable
        ? getItemLevelMetadataWarning()
        : null;
    orderLevelTrackingWarning = !orderLevelTrackingAvailable
        ? getMessage('csc.warning.orderlevelactionsnotallowedduetomissingmetadata')
        : null;

    if (statusSummary) {
        if (!itemLevelActionsAvailable) {
            statusSummary.canCapture = false;
            statusSummary.canRefund = false;
        }

    }

    if (orderLevelViewData && !orderLevelActionsAvailable) {
        orderLevelViewData.canCapture = false;
        orderLevelViewData.canRefund = false;
    }

    itemLevelCanCapture = !!(itemLevelActionsAvailable && statusSummary && statusSummary.canCapture);
    itemLevelCanRefund = !!(itemLevelActionsAvailable && statusSummary && statusSummary.canRefund);
    orderLevelCanCapture = !!(orderLevelActionsAvailable && orderLevelViewData && orderLevelViewData.canCapture);
    orderLevelCanRefund = !!(orderLevelActionsAvailable && orderLevelViewData && orderLevelViewData.canRefund);
    canCancel = !!(statusSummary && statusSummary.canCancel);
    orderTabAvailable = !!(orderLevelCanCapture || orderLevelCanRefund || canCancel || orderLevelTrackingWarning);
    showOperationTabs = !!(itemLevelCanCapture || itemLevelCanRefund || orderTabAvailable);

    if ((activeTabScope === 'order' && orderTabAvailable) || (!itemLevelActionsAvailable && orderTabAvailable)) {
        resolvedActiveTab = 'order';
    } else {
        resolvedActiveTab = 'item';
    }

    if (!showOperationTabs) {
        itemLevelActionsDisabledMessage = null;
        itemLevelTrackingWarning = null;
        orderLevelTrackingWarning = null;
    }

    if (!order) {
        errorMessage = getMessage('csc.error.ordernotfound');
    } else if (!paymentInstrument) {
        errorMessage = getMessage('csc.error.nopaymentinstrument');
        isPayoneAssociatedPayment = false;
    } else if (!identifiers) {
        errorMessage = getMessage('csc.error.identifiersnotstored');
    } else if (!commerceCaseResult || !commerceCaseResult.ok) {
        errorMessage = getMessage('csc.action.failed');
    }

    return {
        orderNo: orderNo,
        paymentMethod: paymentInstrument ? paymentInstrument.paymentMethod : null,
        merchantReference: merchantReference,
        hasIdentifiers: !!identifiers,
        identifiers: identifiers,
        statusSummary: statusSummary,
        orderLevelViewData: orderLevelViewData,
        noActionsMessage: getNoActionsMessage(statusSummary, identifiers),
        items: items,
        actionResult: actionResult,
        commerceCaseResult: commerceCaseResult,
        itemLevelTrackingAvailable: itemLevelTrackingAvailable,
        itemLevelActionsAvailable: itemLevelActionsAvailable,
        itemLevelActionsDisabledMessage: itemLevelActionsDisabledMessage,
        itemLevelHasDiscount: hasOrderLevelDiscount,
        itemLevelCanCapture: itemLevelCanCapture,
        itemLevelCanRefund: itemLevelCanRefund,
        orderLevelActionsAvailable: orderLevelActionsAvailable,
        orderTabAvailable: orderTabAvailable,
        orderLevelCanCapture: orderLevelCanCapture,
        orderLevelCanRefund: orderLevelCanRefund,
        orderLevelAmountActionUsed: orderLevelAmountActionUsed,
        cancelReasonOptions: cancelReasonOptions,
        selectedCancelReason: resolvedCancelReason,
        showOperationTabs: showOperationTabs,
        activeTab: resolvedActiveTab,
        itemLevelTrackingWarning: itemLevelTrackingWarning,
        orderLevelTrackingWarning: orderLevelTrackingWarning,
        canCancel: canCancel,
        error: {
            isError: !order || !paymentInstrument || !identifiers || !commerceCaseResult || !commerceCaseResult.ok,
            message: errorMessage,
            isPayoneAssociatedPayment: isPayoneAssociatedPayment
        },
        hasActionableIdentifiers: actionableIdentifiers
    };
}

module.exports = {
    buildViewData: buildViewData,
    executeAction: executeAction
};
