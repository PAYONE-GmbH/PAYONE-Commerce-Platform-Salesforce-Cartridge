'use strict';

var Logger = require('dw/system/Logger');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Site = require('dw/system/Site');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');

var webhookUtils = require('*/cartridge/scripts/helpers/payoneWebhookUtils');
var emailHelpers = require('*/cartridge/scripts/helpers/emailHelpers');
var payoneEventStatuses = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper').eventStatuses;

var WEBHOOK_LOGGER = Logger.getLogger('payone', 'webhook');

var iterator;
var maxItems;
var handledCount;
var totalCount;
var processedCount;
var errorCount;
var jobStartDate;

/**
* Retrieves the event ID from the provided custom object.
* @param {dw.object.CustomObject} customObject - The custom object containing the event information.
* @returns {string} The event ID extracted from the custom object's key value.
*/
function getEventId(customObject) {
    return customObject.custom.id;
}

/**
* Retrieves the PAYONE payment merchant reference from the queued custom object or webhook payload.
*
* @param {dw.object.CustomObject|Object} customObject - Queued webhook custom object.
* @param {Object} payload - Parsed webhook payload.
* @returns {string|null} Merchant reference as a string if found, otherwise null.
*/
function getMerchantReference(customObject, payload) {
    if (customObject && customObject.custom) {
        if (customObject.custom.merchantReference) {
            return customObject.custom.merchantReference + '';
        }
    }

    if (payload && payload.payment && payload.payment.paymentOutput && payload.payment.paymentOutput.references && payload.payment.paymentOutput.references.merchantReference) {
        return payload.payment.paymentOutput.references.merchantReference + '';
    }

    return null;
}

/**
* Extracts and normalizes the payment status from a webhook event payload.
* Checks for the payment status in multiple possible locations within the payload object,
* prioritizing 'payload.payment.paymentStatus', then 'payload.payment.status', then 'payload.paymentStatus', and finally 'payload.status'.
* Returns the status as an uppercase string, or an empty string if not found.
*
* @param {Object} payload - The webhook event payload object potentially containing payment status information.
* @returns {string} The normalized (uppercase) payment status, or an empty string if not present.
*/
function getPaymentStatus(payload) {
    var statusValue =
        (payload && payload.payment && (payload.payment.paymentStatus || payload.payment.status)) ||
        (payload && payload.paymentStatus) ||
        (payload && payload.status) ||
        '';

    return (statusValue + '').toUpperCase();
}

/**
* Determines whether a webhook event is related to a payment.
* Checks if the event type string contains 'payment' (case-insensitive) or if the payload has a 'payment' property.
*
* @param {string} eventType - The type of the webhook event.
* @param {Object} payload - The payload object associated with the event.
* @returns {boolean} True if the event is a payment event, otherwise false.
*/
function isPaymentEvent(eventType, payload) {
    var normalizedEventType = (eventType || '').toLowerCase();

    return normalizedEventType.indexOf('payment') > -1 || !!(payload && payload.payment);
}

/**
* Sends an order status email to the customer using the specified template and subject.
* Retrieves the customer's email and the site's customer service email address, and sends an email if both are available.
*
* @param {dw.order.Order} order - The order object containing order details and customer email.
* @param {string} template - The email template to use for the message body.
* @param {string} subject - The subject line for the email.
* @returns {void}
*/
function sendOrderStatusEmail(order, template, subject) {
    var customerEmail = order.getCustomerEmail();
    var currentSite = Site.getCurrent();
    var fromAddress = currentSite ? currentSite.getCustomPreferenceValue('customerServiceEmail') : null;

    if (!customerEmail || !fromAddress) {
        return;
    }

    emailHelpers.send(
        {
            to: customerEmail,
            subject: subject,
            from: fromAddress + '',
            type: 0
        },
        template,
        {
            orderNo: order.orderNo,
            order: order
        }
    );
}

/**
* Executes the payment flow for an order based on the provided payment status and event ID.
* Places or fails the order transactionally and sends the appropriate status email.
*
* @param {dw.order.Order} order - The order object to process.
* @param {string} eventId - The unique identifier for the webhook event.
* @param {string} paymentStatus - Normalized PAYONE payment status.
* @returns {string} - Returns 'PLACED' if the order was placed, 'FAILED' if the order was failed, or 'NO_ACTION' if no action was taken.
* @throws {Error} - Throws an error if placing or failing the order fails.
*/
function executeCreatedOrderPaymentFlow(order, eventId, paymentStatus) {
    var placeOrFailStatus;

    if (payoneEventStatuses.SUCCESSFUL[paymentStatus]) {
        placeOrFailStatus = Transaction.wrap(function () {
            return OrderMgr.placeOrder(order);
        });

        if (placeOrFailStatus && placeOrFailStatus.isError()) {
            throw new Error('Failed to place order ' + order.orderNo + ' for event ' + eventId);
        }

        sendOrderStatusEmail(order, 'payone/emails/orderPlacedWebhook', Resource.msgf('order.placed.subject', 'payoneEmail', null, order.orderNo));
        return 'PLACED';
    }

    if (payoneEventStatuses.UNSUCCESSFUL[paymentStatus]) {
        placeOrFailStatus = Transaction.wrap(function () {
            return OrderMgr.failOrder(order, false);
        });

        if (placeOrFailStatus && placeOrFailStatus.isError()) {
            throw new Error('Failed to fail order ' + order.orderNo + ' for event ' + eventId);
        }

        sendOrderStatusEmail(order, 'payone/emails/orderFailedWebhook', Resource.msgf('order.failed.subject', 'payoneEmail', null, order.orderNo));
        return 'FAILED';
    }

    return 'NO_ACTION';
}

/**
* Removes a specified webhook event custom object from the system.
* @param {dw.object.CustomObject} event - The custom object representing the webhook event to remove.
* @returns {void}
*/
function removeEvent(event) {
    if (!event) {
        return;
    }

    Transaction.wrap(function () {
        CustomObjectMgr.remove(event);
    });
}

/**
* Adds error information to a webhook event object by updating its custom attributes within a transaction.
* Sets the processing status to 'ERROR', increments the processing attempts counter, and stores the latest error message (truncated to 4000 characters).
*
* @param {Object} result - The result object containing error details, expected to have an 'errorMessage' property.
* @param {dw.object.CustomObject} event - The webhook event custom object to update.
* @returns {void}
*/
function addErrorToEventObject(result, event) {
    if (!event || !result) {
        return;
    }

    Transaction.wrap(function () {
        event.custom.processingStatus = 'ERROR';
        event.custom.processingAttempts = Number(event.custom.processingAttempts || 0) + 1;
        event.custom.lastErrorMessage = (result.errorMessage || 'Unknown processing error').slice(0, 4000);
    });
}

exports.beforeStep = function (parameters) {
    var parsedMaxItems = parameters && parameters.MaxItems ? parseInt(parameters.MaxItems, 10) : 200;

    maxItems = Number.isNaN(parsedMaxItems) ? 200 : parsedMaxItems;
    handledCount = 0;
    processedCount = 0;
    errorCount = 0;
    jobStartDate = new Date();

    iterator = CustomObjectMgr.queryCustomObjects(
        webhookUtils.WEBHOOK_CO_TYPE,
        'creationDate < {0}',
        'creationDate asc',
        jobStartDate
    );

    totalCount = iterator ? Math.min(Number(iterator.count || 0), maxItems) : 0;
};

exports.getTotalCount = function () {
    return totalCount;
};

exports.read = function () {
    if (!iterator || handledCount >= maxItems || !iterator.hasNext()) {
        return null;
    }

    handledCount += 1;
    return iterator.next();
};

exports.process = function (customObject) {
    var payload;
    var merchantReference;
    var order;
    var eventType;
    var noteData;
    var noteText;
    var eventId;
    var paymentStatus;
    var flowAction = 'NO_ACTION';

    try {
        eventId = getEventId(customObject);
        payload = JSON.parse(customObject.custom.payload || '{}');
        merchantReference = getMerchantReference(customObject, payload);
        eventType = customObject.custom.type || payload.type || 'unknown';
        paymentStatus = getPaymentStatus(payload);

        if (!merchantReference) {
            throw new Error('Missing merchantReference id for event ' + eventId);
        }

        order = OrderMgr.searchOrder('custom.payoneMerchantReference = {0}', merchantReference);

        if (!order) {
            throw new Error('No order found for merchantReference id ' + merchantReference);
        }

        if (order.getStatus().value === Order.ORDER_STATUS_CREATED && isPaymentEvent(eventType, payload)) {
            flowAction = executeCreatedOrderPaymentFlow(order, eventId, paymentStatus);
        }

        noteData = {
            eventId: eventId,
            eventType: eventType,
            merchantReference: merchantReference,
            paymentStatus: paymentStatus,
            flowAction: flowAction,
            processedAt: new Date().toISOString(),
            payload: payload
        };

        noteText = JSON.stringify(noteData).slice(0, 4000);

        Transaction.wrap(function () {
            order.addNote('PAYONE webhook event', noteText);
        });

        return {
            eventId: eventId,
            success: true,
            orderNo: order.orderNo,
            eventType: eventType,
            merchantReference: merchantReference,
            paymentStatus: paymentStatus,
            flowAction: flowAction
        };
    } catch (processingError) {
        return {
            eventId: getEventId(customObject),
            success: false,
            merchantReference: merchantReference,
            paymentStatus: paymentStatus,
            errorMessage: (processingError && processingError.message ? processingError.message : (processingError + ''))
        };
    }
};

exports.write = function (results) {
    var i;
    var result;
    var eventObject;

    for (i = 0; i < results.size(); i++) {
        result = results.get(i);

        if (!result || !result.eventId) {
            continue; // eslint-disable-line no-continue
        }

        eventObject = CustomObjectMgr.getCustomObject(webhookUtils.WEBHOOK_CO_TYPE, result.eventId);

        if (!eventObject) {
            continue; // eslint-disable-line no-continue
        }

        if (result.success) {
            removeEvent(eventObject);

            processedCount += 1;
            WEBHOOK_LOGGER.info(
                'PAYONE webhook event processed and removed. EventId={0}, MerchantReference={1}, OrderNo={2}, EventType={3}, PaymentStatus={4}, FlowAction={5}',
                result.eventId,
                result.merchantReference || '',
                result.orderNo || '',
                result.eventType || '',
                result.paymentStatus || '',
                result.flowAction || ''
            );
        } else {
            addErrorToEventObject(result, eventObject);

            errorCount += 1;
            WEBHOOK_LOGGER.info(
                'PAYONE webhook event kept with ERROR status. EventId={0}, MerchantReference={1}, PaymentStatus={2}, Error={3}',
                result.eventId,
                result.merchantReference || '',
                result.paymentStatus || '',
                result.errorMessage || 'Unknown processing error'
            );
        }
    }
};

exports.afterStep = function () {
    if (iterator) {
        iterator.close();
    }

    WEBHOOK_LOGGER.info(
        'PAYONE webhook job finished. JobStart={0}, Processed={1}, Errors={2}, Handled={3}',
        jobStartDate ? jobStartDate.toISOString() : '',
        processedCount,
        errorCount,
        handledCount
    );
};
