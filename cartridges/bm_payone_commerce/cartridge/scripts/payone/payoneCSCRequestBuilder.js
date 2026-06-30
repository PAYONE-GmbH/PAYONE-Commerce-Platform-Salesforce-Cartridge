'use strict';

var CaptureRequest = require('*/cartridge/scripts/models/payone/CaptureRequest');
var CancelPaymentRequest = require('*/cartridge/scripts/models/payone/CancelPaymentRequest');
var RefundRequest = require('*/cartridge/scripts/models/payone/RefundRequest');
var CartItemInput = require('*/cartridge/scripts/models/payone/CartItemInput');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');

var toArray = PayoneCommonUtils.toArray;

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
 * Returns whether a PAYONE checkout row should be displayed only for information in CSC.
 *
 * @param {Object} checkoutItem - PAYONE checkout item for the row.
 * @returns {boolean} True when the row should not be available for item-level actions.
 */
function isInformationalOnlyCheckoutItem(checkoutItem) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};

    return details.productType === 'DISCOUNT' || (Number(details.productPrice) || 0) <= 0;
}

/**
 * Normalizes one stored CSC row-status record.
 *
 * @param {Object} record - Stored item-level status record.
 * @returns {{captured:number, refunded:number, cancelled:number}} Normalized status quantities.
 */
function normalizeStoredRowStatus(record) {
    var safeRecord = record || {};

    return {
        captured: normalizeQuantity(safeRecord.captured || safeRecord.CAPTURED),
        refunded: normalizeQuantity(safeRecord.refunded || safeRecord.REFUNDED),
        cancelled: normalizeQuantity(safeRecord.cancelled || safeRecord.CANCELLED)
    };
}

/**
 * Reads the locally stored CSC quantities for one row.
 *
 * @param {Object} checkoutItem - PAYONE checkout item for the row.
 * @param {Object} itemLevelStatuses - Stored CSC item-level status map.
 * @param {string} selectionId - CSC row id used as the storage key.
 * @returns {{orderedQuantity:number, capturedQuantity:number, refundedQuantity:number, cancelledQuantity:number, capturableQuantity:number, refundableQuantity:number}}
 * Local quantity summary for the row.
 */
function getStoredLocalRowQuantities(checkoutItem, itemLevelStatuses, selectionId) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
    var orderedQuantity = Number(details.quantity) || 0;
    var storedStatuses = itemLevelStatuses && selectionId ? normalizeStoredRowStatus(itemLevelStatuses[selectionId]) : null;
    var capturedQuantity = storedStatuses ? storedStatuses.captured : 0;
    var refundedQuantity = storedStatuses ? storedStatuses.refunded : 0;
    var cancelledQuantity = storedStatuses ? storedStatuses.cancelled : 0;

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
 * Builds the default local CSC quantities for a row with no stored status yet.
 *
 * @param {Object} checkoutItem - PAYONE checkout item for the row.
 * @returns {{orderedQuantity:number, capturedQuantity:number, refundedQuantity:number, cancelledQuantity:number, capturableQuantity:number, refundableQuantity:number}}
 * Default local quantity summary.
 */
function getDefaultLocalRowQuantities(checkoutItem) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
    var orderedQuantity = Number(details.quantity) || 0;

    return {
        orderedQuantity: orderedQuantity,
        capturedQuantity: 0,
        refundedQuantity: 0,
        cancelledQuantity: 0,
        capturableQuantity: orderedQuantity,
        refundableQuantity: 0
    };
}

/**
 * Returns the checkout object from a PAYONE commerce-case response.
 *
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @returns {Object|null} Checkout payload or null when unavailable.
 */
function getCheckoutFromCommerceCaseResult(commerceCaseResult) {
    var safeData = commerceCaseResult && commerceCaseResult.data ? commerceCaseResult.data : null;

    return safeData ? (safeData.checkout || (safeData.checkouts && safeData.checkouts[0])) : null;
}

/**
 * Returns SFCC order product line items in their stable platform order.
 *
 * @param {dw.order.Order|Object} order - Order to inspect.
 * @returns {Array} Product line items as a plain array.
 */
function getOrderLineItems(order) {
    if (!order) {
        return [];
    }

    if (typeof order.getProductLineItems === 'function') {
        return toArray(order.getProductLineItems());
    }

    return toArray(order.productLineItems);
}

/**
 * Returns all checkout shopping-cart items as a plain array.
 *
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {Array} Checkout items.
 */
function getCheckoutItems(checkout) {
    return toArray(checkout && checkout.shoppingCart ? checkout.shoppingCart.items : []);
}

/**
 * Checks whether a checkout row is a GOODS row.
 *
 * GOODS rows are the only rows that map to SFCC product line items.
 *
 * @param {Object} checkoutItem - PAYONE checkout item.
 * @returns {boolean} True when the row is a GOODS row.
 */
function isGoodsCheckoutItem(checkoutItem) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};

    return details.productType === 'GOODS';
}

/**
 * Returns only the GOODS rows from the checkout.
 *
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {Array} Goods-only checkout items.
 */
function getGoodsCheckoutItems(checkout) {
    return getCheckoutItems(checkout).filter(function (item) {
        return isGoodsCheckoutItem(item);
    });
}

/**
 * Checks whether a checkout row should be shown in the CSC item table.
 *
 * @param {Object} checkoutItem - PAYONE checkout item.
 * @returns {boolean} True when the row belongs in the CSC UI.
 */
function isCSCCheckoutItem(checkoutItem) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};

    return details.productType === 'GOODS' ||
        details.productType === 'SHIPMENT' ||
        details.productType === 'DISCOUNT';
}

/**
 * Returns the checkout rows that CSC shows and works with.
 *
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {Array} CSC-visible checkout items.
 */
function getCSCCheckoutItems(checkout) {
    return getCheckoutItems(checkout).filter(function (item) {
        return isCSCCheckoutItem(item);
    });
}

/**
 * Checks whether the checkout contains an order-level discount row.
 *
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {boolean} True when at least one discount row exists.
 */
function hasOrderLevelDiscount(checkout) {
    return getCheckoutItems(checkout).some(function (item) {
        var details = item && item.orderLineDetails ? item.orderLineDetails : {};

        return details.productType === 'DISCOUNT';
    });
}

/**
 * Builds a fallback CSC row id for rows without an SFCC line item.
 *
 * @param {Object} checkoutItem - PAYONE checkout item.
 * @param {number} checkoutIndex - Item position within the CSC checkout item list.
 * @returns {string} Fallback CSC row id.
 */
function buildFallbackSelectionId(checkoutItem, checkoutIndex) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
    var productCode = details.productCode || details.productType || 'ITEM';

    return 'CHECKOUT_LINE_' + checkoutIndex + '_' + productCode;
}

/**
 * Resolves the currency code from the order first, then from the checkout.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {string|null} ISO currency code or null.
 */
function getCurrencyCode(order, checkout) {
    if (order) {
        return order.currencyCode || (typeof order.getCurrencyCode === 'function' ? order.getCurrencyCode() : null);
    }

    return checkout && checkout.amountOfMoney ? checkout.amountOfMoney.currencyCode : null;
}

/**
 * Converts an SFCC line item into PAYONE-style order-line details for matching.
 *
 * @param {dw.order.ProductLineItem|Object} lineItem - SFCC line item.
 * @returns {Object} Normalized order-line details.
 */
function getLineItemOrderDetails(lineItem) {
    return new CartItemInput(lineItem).toOrderUpdate().orderLineDetails || {};
}

/**
 * Normalizes an optional value so row matching compares like with like.
 *
 * @param {*} value - Candidate value.
 * @returns {string|null} String value or null.
 */
function normalizeOptionalValue(value) {
    return value === null || typeof value === 'undefined' ? null : String(value);
}

/**
 * Checks whether one SFCC product line item matches one PAYONE GOODS row.
 *
 * @param {dw.order.ProductLineItem|Object} lineItem - SFCC line item.
 * @param {Object} checkoutItem - PAYONE checkout item.
 * @returns {boolean} True when both rows represent the same logical item.
 */
function lineItemMatchesCheckoutItem(lineItem, checkoutItem) {
    var lineItemDetails = getLineItemOrderDetails(lineItem);
    var checkoutDetails = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};

    return normalizeOptionalValue(lineItemDetails.productCode) === normalizeOptionalValue(checkoutDetails.productCode) &&
        normalizeQuantity(lineItemDetails.quantity) === normalizeQuantity(checkoutDetails.quantity) &&
        normalizeQuantity(lineItemDetails.productPrice) === normalizeQuantity(checkoutDetails.productPrice) &&
        normalizeQuantity(lineItemDetails.taxAmount) === normalizeQuantity(checkoutDetails.taxAmount) &&
        normalizeOptionalValue(lineItemDetails.merchantShopDeliveryReference) === normalizeOptionalValue(checkoutDetails.merchantShopDeliveryReference);
}

/**
 * Calculates the tax amount for the selected row quantity.
 *
 * @param {Object} details - PAYONE order-line details.
 * @param {number} quantity - Selected quantity.
 * @returns {number|null} Tax amount for the selected quantity.
 */
function getSelectedTaxAmount(details, quantity) {
    var originalQuantity = Number(details && details.quantity) || 0;
    var taxAmount = details && details.taxAmount !== null && typeof details.taxAmount !== 'undefined'
        ? Number(details.taxAmount)
        : null;

    if (taxAmount === null || quantity <= 0) {
        return null;
    }

    if (details.taxAmountPerUnit) {
        return taxAmount;
    }

    if (!originalQuantity || originalQuantity <= 0) {
        return taxAmount;
    }

    return Math.round((taxAmount / originalQuantity) * quantity);
}

/**
 * Builds a request item from one checkout row and the selected quantity.
 *
 * @param {Object} checkoutItem - PAYONE checkout item.
 * @param {number} quantity - Selected action quantity.
 * @returns {Object} PAYONE request item for the selected quantity.
 */
function cloneCheckoutItem(checkoutItem, quantity) {
    var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};

    return {
        invoiceData: checkoutItem && checkoutItem.invoiceData ? {
            description: checkoutItem.invoiceData.description || null
        } : null,
        orderLineDetails: {
            id: details.id || null,
            productCode: details.productCode || null,
            productType: details.productType || 'GOODS',
            quantity: quantity,
            productPrice: Number(details.productPrice) || 0,
            taxAmount: getSelectedTaxAmount(details, quantity),
            taxAmountPerUnit: details.taxAmountPerUnit === true,
            merchantShopDeliveryReference: details.merchantShopDeliveryReference || null
        }
    };
}

/**
 * Finds the next unused GOODS row that exactly matches the SFCC line item.
 *
 * @param {Array} checkoutItems - PAYONE goods checkout items.
 * @param {dw.order.ProductLineItem|Object} lineItem - SFCC line item.
 * @param {Object} usedIndexes - Map of already-consumed checkout indexes.
 * @returns {{checkoutItem:Object, index:number}|null} Matching row and its index, or null.
 */
function findExactMatchingCheckoutItem(checkoutItems, lineItem, usedIndexes) {
    var i;

    for (i = 0; i < checkoutItems.length; i += 1) {
        if (!usedIndexes[i] && lineItemMatchesCheckoutItem(lineItem, checkoutItems[i])) {
            usedIndexes[i] = true;
            return {
                checkoutItem: checkoutItems[i],
                index: i
            };
        }
    }

    return null;
}

/**
 * Builds the row mapping between SFCC product line items and PAYONE GOODS rows.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} checkout - PAYONE checkout payload.
 * Matching is sequence-first. Exact matching is only the fallback.
 *
 * @returns {{lineItemByCheckoutIndex:Array}} Mapping data.
 */
function buildOrderCheckoutItemMappings(order, checkout) {
    var lineItems = getOrderLineItems(order);
    var checkoutItems = getGoodsCheckoutItems(checkout);
    var lineItemByCheckoutIndex = [];
    var usedIndexes = {};

    lineItems.forEach(function (lineItem, index) {
        var positionalCheckoutItem = checkoutItems[index];
        var exactMatch;

        if (positionalCheckoutItem && lineItemMatchesCheckoutItem(lineItem, positionalCheckoutItem)) {
            usedIndexes[index] = true;
            lineItemByCheckoutIndex[index] = lineItem;
            return;
        }

        exactMatch = findExactMatchingCheckoutItem(checkoutItems, lineItem, usedIndexes);
        if (exactMatch) {
            lineItemByCheckoutIndex[exactMatch.index] = lineItem;
        }
    });

    return {
        lineItemByCheckoutIndex: lineItemByCheckoutIndex
    };
}

/**
 * Builds the CSC row-id maps for all rows shown in the item table.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {{checkoutItems:Array, checkoutItemBySelectionId:Object, lineItemBySelectionId:Object, selectionIdByCheckoutIndex:Array}}
 * CSC row-id mapping data.
 */
function buildCheckoutSelectionMappings(order, checkout) {
    var allCheckoutItems = getCSCCheckoutItems(checkout);
    var goodsMappings = buildOrderCheckoutItemMappings(order, checkout);
    var goodsIndex = -1;
    var checkoutItemBySelectionId = {};
    var lineItemBySelectionId = {};
    var selectionIdByCheckoutIndex = [];

    allCheckoutItems.forEach(function (checkoutItem, checkoutIndex) {
        var details = checkoutItem && checkoutItem.orderLineDetails ? checkoutItem.orderLineDetails : {};
        var lineItem = null;
        var selectionId;

        if (isGoodsCheckoutItem(checkoutItem)) {
            goodsIndex += 1;
            lineItem = goodsMappings.lineItemByCheckoutIndex[goodsIndex] || null;
        }

        selectionId = lineItem
            ? String(lineItem.UUID)
            : (details.id || buildFallbackSelectionId(checkoutItem, checkoutIndex));

        checkoutItemBySelectionId[selectionId] = checkoutItem;
        selectionIdByCheckoutIndex[checkoutIndex] = selectionId;

        if (lineItem) {
            lineItemBySelectionId[selectionId] = lineItem;
        }
    });

    return {
        checkoutItems: allCheckoutItems,
        checkoutItemBySelectionId: checkoutItemBySelectionId,
        lineItemBySelectionId: lineItemBySelectionId,
        selectionIdByCheckoutIndex: selectionIdByCheckoutIndex
    };
}

/**
 * Returns the local CSC quantity summary for one row.
 *
 * Local item tracking is the source of truth for the CSC item table. When no local
 * row state exists yet, the row is treated as completely unprocessed.
 *
 * @param {Object} checkoutItem - PAYONE checkout item for the row.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @param {string} [selectionId] - Optional CSC row id for local tracking lookup.
 * @returns {{orderedQuantity:number, capturedQuantity:number, refundedQuantity:number, cancelledQuantity:number, capturableQuantity:number, refundableQuantity:number}}
 * Local quantity summary for the row.
 */
function getLocalRowQuantities(checkoutItem, itemLevelStatuses, selectionId) {
    if (itemLevelStatuses && selectionId) {
        return getStoredLocalRowQuantities(checkoutItem, itemLevelStatuses, selectionId);
    }

    return getDefaultLocalRowQuantities(checkoutItem);
}

/**
 * Returns the remaining quantity available for a particular CSC row action.
 *
 * @param {Object} checkoutItem - PAYONE checkout item for the row.
 * @param {string} action - `capture` or `refund`.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @param {string} [selectionId] - Optional CSC row id for local tracking lookup.
 * @returns {number} Available quantity for the row action.
 */
function getAvailableRowQuantity(checkoutItem, action, itemLevelStatuses, selectionId) {
    var quantities = getLocalRowQuantities(checkoutItem, itemLevelStatuses, selectionId);

    if (isInformationalOnlyCheckoutItem(checkoutItem)) {
        return 0;
    }

    if (action === 'refund') {
        return quantities.refundableQuantity;
    }

    return quantities.capturableQuantity;
}

/**
 * Merges repeated submitted rows so server-side validation uses the total quantity per row.
 *
 * @param {Array} selectedItems - Submitted item-table selections.
 * @returns {Array} Normalized row selections with summed quantities per id.
 */
function mergeSelectedRowQuantities(selectedItems) {
    var aggregatedQuantities = {};
    var normalized = [];

    toArray(selectedItems).forEach(function (selection) {
        var selectionId = selection && selection.id ? String(selection.id) : '';
        var quantity = normalizeQuantity(selection && selection.quantity);

        if (!selectionId || quantity <= 0) {
            return;
        }

        aggregatedQuantities[selectionId] = (aggregatedQuantities[selectionId] || 0) + quantity;
    });

    Object.keys(aggregatedQuantities).forEach(function (selectionId) {
        normalized.push({
            id: selectionId,
            quantity: aggregatedQuantities[selectionId]
        });
    });

    return normalized;
}

/**
 * Builds the PAYONE request items for the selected CSC rows.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} checkout - PAYONE checkout payload.
 * @param {Array} selectedItems - Submitted CSC row selections.
 * @param {string} action - `capture` or `refund`.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @returns {Array} PAYONE request items for the action request.
 */
function buildSelectedRequestItems(order, checkout, selectedItems, action, itemLevelStatuses) {
    var selectionMappings = buildCheckoutSelectionMappings(order, checkout);
    var normalizedSelections = mergeSelectedRowQuantities(selectedItems);
    var result = [];

    normalizedSelections.forEach(function (selection) {
        var checkoutItem = selectionMappings.checkoutItemBySelectionId[selection.id] || null;
        var quantity;

        if (!checkoutItem) {
            return;
        }

        quantity = Math.min(
            selection.quantity,
            getAvailableRowQuantity(
                checkoutItem,
                action,
                itemLevelStatuses,
                selection.id
            )
        );

        if (quantity <= 0) {
            return;
        }

        result.push(cloneCheckoutItem(checkoutItem, quantity));
    });

    return result;
}

/**
 * Checks whether any submitted CSC row quantity is invalid for the chosen action.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {Array} selectedItems - Submitted CSC row selections.
 * @param {string} action - `capture` or `refund`.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @returns {boolean} True when any selected row quantity is invalid.
 */
function hasInvalidSelectedRowQuantities(order, commerceCaseResult, selectedItems, action, itemLevelStatuses) {
    var checkout = getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var selectionMappings = buildCheckoutSelectionMappings(order, checkout);
    var normalizedSelections = mergeSelectedRowQuantities(selectedItems);
    var invalid = false;

    normalizedSelections.forEach(function (selection) {
        var checkoutItem = selectionMappings.checkoutItemBySelectionId[selection.id] || null;
        var availableQuantity;

        if (invalid) {
            return;
        }

        if (!checkoutItem) {
            invalid = true;
            return;
        }

        availableQuantity = getAvailableRowQuantity(
            checkoutItem,
            action,
            itemLevelStatuses,
            selection.id
        );

        if (selection.quantity > availableQuantity) {
            invalid = true;
        }
    });

    return invalid;
}

/**
 * Sums the gross amount represented by the selected request items.
 *
 * @param {Array} items - PAYONE request items.
 * @returns {number} Total gross amount in cents.
 */
function getAmountFromCheckoutItems(items) {
    var total = 0;

    items.forEach(function (item) {
        var details = item.orderLineDetails || {};

        total += (Number(details.productPrice) || 0) * (Number(details.quantity) || 0);
    });

    return total;
}

/**
 * Builds the PAYONE capture request body for the selected CSC rows.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {Array} selectedItems - Submitted CSC row selections.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @returns {Object|null} Capture request payload or null when nothing valid is selected.
 */
function buildCaptureRequest(order, commerceCaseResult, selectedItems, itemLevelStatuses) {
    var checkout = getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var items = buildSelectedRequestItems(order, checkout, selectedItems, 'capture', itemLevelStatuses);
    var amount = getAmountFromCheckoutItems(items);
    var openAmount = checkout && checkout.statusOutput ? Number(checkout.statusOutput.openAmount) || 0 : 0;

    if (!checkout || !items.length || amount <= 0) {
        return null;
    }

    return new CaptureRequest({
        amount: amount,
        isFinal: openAmount > 0 ? amount >= openAmount : null,
        references: {
            merchantReference: payoneMerchantReferenceHelper.buildCaptureReference()
        },
        delivery: {
            items: items
        }
    }).toRequest();
}

/**
 * Builds the PAYONE refund request body for the selected CSC rows.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {Array} selectedItems - Submitted CSC row selections.
 * @param {string} returnReason - Refund reason to send to PAYONE.
 * @param {Object} [itemLevelStatuses] - Optional stored CSC item-level status map.
 * @returns {Object|null} Refund request payload or null when nothing valid is selected.
 */
function buildRefundRequest(order, commerceCaseResult, selectedItems, returnReason, itemLevelStatuses) {
    var checkout = getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var items = buildSelectedRequestItems(order, checkout, selectedItems, 'refund', itemLevelStatuses);
    var amount = getAmountFromCheckoutItems(items);
    var currencyCode = getCurrencyCode(order, checkout);

    if (!checkout || !items.length || amount <= 0 || !currencyCode) {
        return null;
    }

    return new RefundRequest({
        amountOfMoney: {
            amount: amount,
            currencyCode: currencyCode
        },
        references: {
            merchantReference: payoneMerchantReferenceHelper.buildRefundReference()
        },
        'return': {
            returnReason: returnReason,
            items: items
        }
    }).toRequest();
}

/**
 * Builds the PAYONE capture request body for an order-level amount action.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {number} amount - Requested minor-unit capture amount.
 * @returns {Object|null} Capture request payload or null when invalid.
 */
function buildOrderLevelCaptureRequest(order, commerceCaseResult, amount) {
    var checkout = getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var openAmount = checkout && checkout.statusOutput ? Number(checkout.statusOutput.openAmount) || 0 : 0;

    if (!checkout || !amount || amount <= 0) {
        return null;
    }

    return new CaptureRequest({
        amount: amount,
        isFinal: openAmount > 0 ? amount >= openAmount : null,
        references: {
            merchantReference: payoneMerchantReferenceHelper.buildCaptureReference()
        }
    }).toRequest();
}

/**
 * Builds the PAYONE refund request body for an order-level amount action.
 *
 * @param {dw.order.Order|Object} order - SFCC order.
 * @param {Object} commerceCaseResult - PAYONE commerce-case service response.
 * @param {number} amount - Requested minor-unit refund amount.
 * @param {string} returnReason - Refund reason to send to PAYONE.
 * @returns {Object|null} Refund request payload or null when invalid.
 */
function buildOrderLevelRefundRequest(order, commerceCaseResult, amount, returnReason) {
    var checkout = getCheckoutFromCommerceCaseResult(commerceCaseResult);
    var currencyCode = getCurrencyCode(order, checkout);

    if (!checkout || !amount || amount <= 0 || !currencyCode) {
        return null;
    }

    return new RefundRequest({
        amountOfMoney: {
            amount: amount,
            currencyCode: currencyCode
        },
        references: {
            merchantReference: payoneMerchantReferenceHelper.buildRefundReference()
        },
        'return': {
            returnReason: returnReason
        }
    }).toRequest();
}

/**
 * Builds the PAYONE cancel request body for an authorization reversal.
 *
 * @param {string} cancellationReason - PAYONE cancellation reason enum.
 * @returns {Object|null} Cancel request payload or null when invalid.
 */
function buildCancelRequest(cancellationReason) {
    var request = new CancelPaymentRequest({
        cancellationReason: cancellationReason
    }).toRequest();

    return request.cancellationReason ? request : null;
}

module.exports = {
    buildCaptureRequest: buildCaptureRequest,
    buildRefundRequest: buildRefundRequest,
    buildCancelRequest: buildCancelRequest,
    buildOrderLevelCaptureRequest: buildOrderLevelCaptureRequest,
    buildOrderLevelRefundRequest: buildOrderLevelRefundRequest,
    buildCheckoutSelectionMappings: buildCheckoutSelectionMappings,
    getLocalRowQuantities: getLocalRowQuantities,
    getCheckoutFromCommerceCaseResult: getCheckoutFromCommerceCaseResult,
    hasOrderLevelDiscount: hasOrderLevelDiscount,
    hasInvalidSelectedRowQuantities: hasInvalidSelectedRowQuantities,
    isInformationalOnlyCheckoutItem: isInformationalOnlyCheckoutItem
};
