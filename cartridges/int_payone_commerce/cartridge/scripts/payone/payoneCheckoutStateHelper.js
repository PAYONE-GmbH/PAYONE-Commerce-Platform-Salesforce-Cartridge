'use strict';

var REDIRECTED_STATUS = 'REDIRECTED';
var CANCELLABLE_CHECKOUT_STATUSES = {
    PENDING_COMPLETION: true,
    COMPLETED: true,
    BILLED: true,
    CHARGEBACKED: true
};
var SUCCESSFUL_EVENT_STATUSES = {
    PENDING_CAPTURE: true,
    CAPTURED: true,
    ACCOUNT_DEBITED: true
};
var UNSUCCESSFUL_STATUSES = {
    CANCELLED: true,
    REJECTED: true,
    REJECTED_CAPTURE: true,
    REJECTED_PAUSE: true,
    REJECTED_REFUND: true,
    REJECTED_UPDATE: true,
    REVERSED: true,
    CHARGEBACKED: true
};
var EVENT_STATUSES = {
    SUCCESSFUL: SUCCESSFUL_EVENT_STATUSES,
    UNSUCCESSFUL: UNSUCCESSFUL_STATUSES
};

/**
 * Resolves the target checkout from PAYONE create/get response variants.
 *
 * @param {Object} source - PAYONE response wrapper or payload.
 * @param {string} [checkoutId] - Expected checkout identifier.
 * @returns {Object|null} Matching checkout or null.
 */
function getCheckout(source, checkoutId) {
    var payload = source && source.data ? source.data : source;
    var checkouts;
    var i;

    if (!payload) {
        return null;
    }

    if (payload.checkout) {
        return payload.checkout;
    }

    checkouts = payload.checkouts || [];

    if (!checkouts.length) {
        return null;
    }

    if (!checkoutId) {
        return checkouts[0];
    }

    for (i = 0; i < checkouts.length; i += 1) {
        if (checkouts[i] && checkouts[i].checkoutId === checkoutId) {
            return checkouts[i];
        }
    }

    return null;
}

/**
 * Resolves the target payment execution from checkout response variants.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {Object|null} Matching payment execution or null.
 */
function getPaymentExecution(checkout, paymentExecutionId) {
    var paymentExecutions;
    var i;

    if (!checkout) {
        return null;
    }

    if (checkout.paymentExecution && (!paymentExecutionId || checkout.paymentExecution.paymentExecutionId === paymentExecutionId)) {
        return checkout.paymentExecution;
    }

    paymentExecutions = checkout.paymentExecutions || [];

    if (!paymentExecutions.length) {
        return paymentExecutionId ? null : (checkout.paymentExecution || null);
    }

    if (!paymentExecutionId) {
        return paymentExecutions[0];
    }

    for (i = 0; i < paymentExecutions.length; i += 1) {
        if (paymentExecutions[i] && paymentExecutions[i].paymentExecutionId === paymentExecutionId) {
            return paymentExecutions[i];
        }
    }

    return null;
}

/**
 * Returns the latest event for the selected payment execution.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {Object|null} Last payment event or null.
 */
function getLastPaymentEvent(checkout, paymentExecutionId) {
    var paymentExecution = getPaymentExecution(checkout, paymentExecutionId);
    var events = paymentExecution && paymentExecution.events;

    if (!events || !events.length) {
        return null;
    }

    return events[events.length - 1];
}

/**
 * Extracts the redirect URL from the PAYONE payment response.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @returns {string|null} Redirect URL or null.
 */
function getRedirectUrl(checkout) {
    var merchantAction = checkout && checkout.paymentResponse && checkout.paymentResponse.merchantAction;
    var redirectData = merchantAction && merchantAction.redirectData;

    return redirectData && redirectData.redirectURL ? redirectData.redirectURL : null;
}

/**
 * Resolves the latest PAYONE payment-event status from events first, then payment response fallback.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {string|null} Latest payment-event status.
 */
function getLatestPaymentEventStatus(checkout, paymentExecutionId) {
    var lastEvent = getLastPaymentEvent(checkout, paymentExecutionId);
    var payment = checkout && checkout.paymentResponse && checkout.paymentResponse.payment;

    if (lastEvent && lastEvent.paymentStatus) {
        return lastEvent.paymentStatus;
    }

    return payment && payment.status ? payment.status : null;
}

/**
 * Extracts the high-level checkout payment status.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @returns {string|null} Checkout payment status.
 */
function getCheckoutPaymentStatus(checkout) {
    return checkout && checkout.statusOutput ? checkout.statusOutput.paymentStatus : null;
}

/**
 * Determines whether the latest payment event is successful enough to continue checkout.
 *
 * @param {Object|null} lastEvent - Latest PAYONE payment event.
 * @returns {boolean} True when the event can place/finalize the SFCC order.
 */
function isSuccessfulPaymentEvent(lastEvent) {
    var eventStatus = lastEvent && lastEvent.paymentStatus;

    if (!eventStatus) {
        return false;
    }

    if (SUCCESSFUL_EVENT_STATUSES[eventStatus]) {
        return true;
    }

    // PAYONE checkout-flow clarification: a SALE event with CREATED status is considered successful.
    return lastEvent.type === 'SALE' && eventStatus === 'CREATED';
}

/**
 * Determines whether the checkout is in a status that allows the PAYONE checkout cancel endpoint.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @returns {boolean} True when order-management cancel is allowed for the checkout.
 */
function canCancelCheckout(checkout) {
    var checkoutStatus = checkout && checkout.checkoutStatus;

    return !!(checkoutStatus && CANCELLABLE_CHECKOUT_STATUSES[checkoutStatus]);
}

/**
 * Determines whether the selected payment execution is in a rejected or unsuccessful state.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {boolean} True when the payment is rejected.
 */
function isRejected(checkout, paymentExecutionId) {
    var latestStatus = getLatestPaymentEventStatus(checkout, paymentExecutionId);

    if (checkout && checkout.errorResponse && checkout.errorResponse.errors && checkout.errorResponse.errors.length) {
        return true;
    }

    if (!latestStatus) {
        return false;
    }

    return !!(UNSUCCESSFUL_STATUSES[latestStatus] || latestStatus.indexOf('REJECTED') === 0);
}

/**
 * Determines whether the selected payment execution still requires a shopper redirect step.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {boolean} True when the payment is still redirected.
 */
function isRedirected(checkout, paymentExecutionId) {
    return !!(getRedirectUrl(checkout) || getLatestPaymentEventStatus(checkout, paymentExecutionId) === REDIRECTED_STATUS);
}

/**
 * Determines whether the selected payment execution reached a safe post-redirect success state.
 *
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - Expected payment execution identifier.
 * @returns {boolean} True when the order may continue in SFCC.
 */
function isSuccessfulPostRedirectState(checkout, paymentExecutionId) {
    var payment = checkout && checkout.paymentResponse && checkout.paymentResponse.payment;
    var paymentStatusOutput = payment && payment.statusOutput;
    var lastEvent = getLastPaymentEvent(checkout, paymentExecutionId);
    var checkoutStatus = checkout && checkout.checkoutStatus;
    var checkoutPaymentStatus = getCheckoutPaymentStatus(checkout);

    if (!checkout || isRejected(checkout, paymentExecutionId) || isRedirected(checkout, paymentExecutionId)) {
        return false;
    }

    if (paymentStatusOutput && paymentStatusOutput.isAuthorized) {
        return true;
    }

    if (paymentStatusOutput && paymentStatusOutput.statusCategory === 'COMPLETED') {
        return true;
    }

    if (checkoutPaymentStatus === 'PAYMENT_COMPLETED') {
        return true;
    }

    if (checkoutStatus === 'COMPLETED' || checkoutStatus === 'BILLED') {
        return true;
    }

    return isSuccessfulPaymentEvent(lastEvent);
}

module.exports = {
    canCancelCheckout: canCancelCheckout,
    getCheckout: getCheckout,
    getCheckoutPaymentStatus: getCheckoutPaymentStatus,
    getLastPaymentEvent: getLastPaymentEvent,
    getLatestPaymentEventStatus: getLatestPaymentEventStatus,
    getPaymentExecution: getPaymentExecution,
    getRedirectUrl: getRedirectUrl,
    isRejected: isRejected,
    isRedirected: isRedirected,
    eventStatuses: EVENT_STATUSES,
    isSuccessfulPaymentEvent: isSuccessfulPaymentEvent,
    isSuccessfulPostRedirectState: isSuccessfulPostRedirectState
};
