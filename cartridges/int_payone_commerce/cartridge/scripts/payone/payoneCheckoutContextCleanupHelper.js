'use strict';

var Logger = require('dw/system/Logger');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var Transaction = require('dw/system/Transaction');

var CancelCheckoutRequest = require('*/cartridge/scripts/models/payone/CancelCheckoutRequest');
var orderManagementCheckoutActionsService = require('*/cartridge/scripts/services/orderManagementCheckoutActionsService');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var payonePayPalHelper = require('*/cartridge/scripts/payone/payonePayPalHelper');
var payoneReservedOrderNoHelper = require('*/cartridge/scripts/payone/payoneReservedOrderNoHelper');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');

var LOGGER = Logger.getLogger('payone', 'checkoutContextCleanup');
var ACTIVE_PRE_AUTHORIZATION_CONTEXT_KEY = 'payoneActivePreAuthorizationContext';

/**
 * Reads a serialized PAYONE context from a payment instrument.
 *
 * @param {dw.order.PaymentInstrument} paymentInstrument - Basket payment instrument.
 * @param {string} attributeId - Custom attribute id.
 * @returns {Object|null} Parsed context or null.
 */
function readPaymentInstrumentContext(paymentInstrument, attributeId) {
    return PayoneCommonUtils.parseJson(
        PayoneCommonUtils.readCustomAttribute(paymentInstrument, attributeId)
    );
}

/**
 * Returns the request session privacy cache when available.
 *
 * @param {Object} req - SFRA request object.
 * @returns {Object|null} Session privacy cache or null.
 */
function getPrivacyCache(req) {
    return req && req.session && req.session.privacyCache ? req.session.privacyCache : null;
}

/**
 * Returns the stored active PAYONE pre-authorization marker.
 *
 * @param {Object} req - SFRA request object.
 * @returns {Object|null} Active context marker or null.
 */
function getActivePreAuthorizationContext(req) {
    var privacyCache = getPrivacyCache(req);

    return privacyCache
        ? PayoneCommonUtils.parseJson(privacyCache.get(ACTIVE_PRE_AUTHORIZATION_CONTEXT_KEY))
        : null;
}

/**
 * Clears the stored active PAYONE pre-authorization marker.
 *
 * @param {Object} req - SFRA request object.
 * @returns {void}
 */
function clearActivePreAuthorizationContext(req) {
    var privacyCache = getPrivacyCache(req);

    if (privacyCache) {
        privacyCache.set(ACTIVE_PRE_AUTHORIZATION_CONTEXT_KEY, null);
    }
    payoneReservedOrderNoHelper.clearReservedOrderNo();
}

/**
 * Returns the helper responsible for one PAYONE pre-authorization payment method.
 *
 * @param {string} paymentMethodId - SFCC payment method id.
 * @returns {Object|null} Method-specific context helper or null.
 */
function getPreAuthorizationContextHelper(paymentMethodId) {
    if (paymentMethodId === payonePayPalHelper.PAYMENT_METHOD_ID) {
        return payonePayPalHelper;
    }

    if (paymentMethodId === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        return payoneSecureInstallmentHelper;
    }

    return null;
}

/**
 * Stores the active PAYONE pre-authorization context marker for this basket.
 *
 * @param {Object} req - SFRA request object.
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @param {string} paymentMethodId - SFCC payment method id.
 * @param {Object|null} context - Stored PAYONE context.
 * @returns {void}
 */
function storeActivePreAuthorizationContext(req, currentBasket, paymentMethodId, context) {
    var privacyCache = getPrivacyCache(req);
    var marker;

    if (!privacyCache || !currentBasket || !currentBasket.UUID || !context || !context.contextKey) {
        return;
    }

    if (paymentMethodId !== payonePayPalHelper.PAYMENT_METHOD_ID
        && paymentMethodId !== payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        return;
    }

    marker = {
        paymentMethodId: paymentMethodId,
        basketUUID: currentBasket.UUID,
        contextKey: context.contextKey
    };

    privacyCache.set(ACTIVE_PRE_AUTHORIZATION_CONTEXT_KEY, JSON.stringify(marker));
}

/**
 * Logs non-OK PAYONE checkout cancel results without failing the storefront flow.
 *
 * @param {Object} cancelResult - Normalized cancel service result.
 * @param {string} operationName - Functional context for the cancel attempt.
 * @param {Object} context - Stored PAYONE context.
 * @returns {void}
 */
function logCancelFailure(cancelResult, operationName, context) {
    if (cancelResult && cancelResult.ok === false) {
        LOGGER.warn(
            'PAYONE checkout cancel returned non-OK during {0}. commerceCaseId: {1}, checkoutId: {2}, userMessage: {3}.',
            operationName || 'unknown',
            context && context.commerceCaseId ? context.commerceCaseId : 'unknown',
            context && context.checkoutId ? context.checkoutId : 'unknown',
            cancelResult.userMessage || 'unknown'
        );
    }
}

/**
 * Cancels a stored PAYONE checkout context when it is still cancellable.
 *
 * @param {Object} context - Stored PAYONE context.
 * @param {Object} contextHelper - Method-specific helper with getCheckoutState.
 * @param {string} operationName - Functional context for logging.
 * @returns {boolean} True when a context was processed.
 */
function cancelContext(context, contextHelper, operationName) {
    var checkoutState;
    var checkout;
    var cancelResult;

    if (!context || !context.commerceCaseId || !context.checkoutId) {
        return false;
    }

    checkoutState = contextHelper.getCheckoutState(context.commerceCaseId, context.checkoutId);
    checkout = checkoutState && checkoutState.checkout;

    if (
        checkoutState
        && checkoutState.getResult
        && checkoutState.getResult.ok
        && payoneCheckoutStateHelper.canCancelCheckout(checkout)
    ) {
        cancelResult = orderManagementCheckoutActionsService.cancel({
            commerceCaseId: context.commerceCaseId,
            checkoutId: context.checkoutId,
            body: new CancelCheckoutRequest({
                cancelType: 'FULL',
                cancellationReason: 'CONSUMER_REQUEST'
            }).toRequest()
        });
        logCancelFailure(cancelResult, operationName, context);
        return true;
    }

    if (checkoutState && checkoutState.getResult && checkoutState.getResult.ok) {
        LOGGER.info(
            'Skipping PAYONE checkout cleanup because checkout status {0} is not cancellable. commerceCaseId: {1}, checkoutId: {2}.',
            checkout && checkout.checkoutStatus ? checkout.checkoutStatus : 'unknown',
            context.commerceCaseId,
            context.checkoutId
        );
        return true;
    }

    LOGGER.warn(
        'Unable to load latest PAYONE checkout state before cleanup. commerceCaseId: {0}, checkoutId: {1}, userMessage: {2}.',
        context.commerceCaseId,
        context.checkoutId,
        checkoutState && checkoutState.getResult && checkoutState.getResult.userMessage
            ? checkoutState.getResult.userMessage
            : 'unknown'
    );
    return true;
}

/**
 * Returns the non-gift-certificate payment instrument that SFRA is validating.
 *
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @returns {dw.order.PaymentInstrument|null} Basket payment instrument or null.
 */
function getSubmittedPaymentInstrument(currentBasket) {
    var paymentInstruments = currentBasket && typeof currentBasket.getPaymentInstruments === 'function'
        ? currentBasket.getPaymentInstruments()
        : currentBasket && currentBasket.paymentInstruments;
    var i;
    var paymentInstrument;
    var paymentMethodId;

    paymentInstruments = PayoneCommonUtils.toArray(paymentInstruments);

    if (!paymentInstruments || !paymentInstruments.length) {
        return null;
    }

    for (i = 0; i < paymentInstruments.length; i += 1) {
        paymentInstrument = paymentInstruments[i];
        paymentMethodId = paymentInstrument && typeof paymentInstrument.getPaymentMethod === 'function'
            ? paymentInstrument.getPaymentMethod()
            : paymentInstrument && paymentInstrument.paymentMethod;

        if (paymentMethodId !== PaymentInstrument.METHOD_GIFT_CERTIFICATE) {
            return paymentInstrument;
        }
    }

    return null;
}

/**
 * Cancels the PAYONE checkout context attached to the payment instrument being rejected.
 *
 * @param {Object} req - SFRA request object.
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @returns {boolean} True when a PAYONE pre-authorization context was processed.
 */
function cleanupInvalidPaymentContexts(req, currentBasket) {
    var paymentInstrument = getSubmittedPaymentInstrument(currentBasket);
    var paymentMethodId;
    var context;

    if (!paymentInstrument) {
        return false;
    }

    paymentMethodId = typeof paymentInstrument.getPaymentMethod === 'function'
        ? paymentInstrument.getPaymentMethod()
        : paymentInstrument.paymentMethod;

    if (paymentMethodId === payonePayPalHelper.PAYMENT_METHOD_ID) {
        context = readPaymentInstrumentContext(paymentInstrument, 'payonePayPalPaymentContext');
        if (cancelContext(context, payonePayPalHelper, 'invalid PayPal payment cleanup')) {
            payonePayPalHelper.clearContext(req, context && context.contextKey);
            clearActivePreAuthorizationContext(req);
            try {
                Transaction.wrap(function () {
                    paymentInstrument.custom.payonePayPalPaymentContext = null;
                });
            } catch (e) {
                LOGGER.warn(
                    'Unable to clear PAYONE PayPal context after checkout cleanup. Error: {0}.',
                    e.message
                );
            }
            return true;
        }
    }

    if (paymentMethodId === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        context = readPaymentInstrumentContext(paymentInstrument, 'payoneSecureInstallmentContext');
        if (cancelContext(context, payoneSecureInstallmentHelper, 'invalid Secure Installment payment cleanup')) {
            payoneSecureInstallmentHelper.clearContext(req, context && context.contextKey);
            clearActivePreAuthorizationContext(req);
            try {
                Transaction.wrap(function () {
                    paymentInstrument.custom.payoneSecureInstallmentContext = null;
                });
            } catch (e) {
                LOGGER.warn(
                    'Unable to clear PAYONE Secure Installment context after checkout cleanup. Error: {0}.',
                    e.message
                );
            }
            return true;
        }
    }

    return false;
}

/**
 * Removes the submitted non-gift-certificate payment instrument from the basket.
 *
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @returns {boolean} True when a payment instrument was removed.
 */
function removeSubmittedPaymentInstrument(currentBasket) {
    var paymentInstrument = getSubmittedPaymentInstrument(currentBasket);

    if (!currentBasket || !paymentInstrument) {
        return false;
    }

    try {
        Transaction.wrap(function () {
            currentBasket.removePaymentInstrument(paymentInstrument);
        });
    } catch (e) {
        LOGGER.warn(
            'Unable to remove stale PAYONE payment instrument before PlaceOrder refresh. Error: {0}.',
            e.message
        );
        return false;
    }

    return true;
}

/**
 * Indicates whether the current basket lost the PAYONE pre-authorization payment
 * instrument after a previous successful payment-step submission.
 *
 * @param {Object} req - SFRA request object.
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @returns {boolean} True when a previously active pre-authorization context is detached.
 */
function hasDetachedActivePreAuthorizationContext(req, currentBasket) {
    var activeContext = getActivePreAuthorizationContext(req);

    if (!currentBasket || !currentBasket.UUID || getSubmittedPaymentInstrument(currentBasket)) {
        return false;
    }

    return !!(
        activeContext
        && activeContext.contextKey
        && activeContext.basketUUID === currentBasket.UUID
        && (
            activeContext.paymentMethodId === payonePayPalHelper.PAYMENT_METHOD_ID
            || activeContext.paymentMethodId === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID
        )
    );
}

/**
 * Cancels and clears a detached active PAYONE pre-authorization context.
 *
 * @param {Object} req - SFRA request object.
 * @returns {boolean} True when an active context marker was processed.
 */
function cleanupDetachedActivePreAuthorizationContext(req) {
    var activeContext = getActivePreAuthorizationContext(req);
    var contextHelper;
    var context;

    if (!activeContext || !activeContext.contextKey) {
        return false;
    }

    contextHelper = getPreAuthorizationContextHelper(activeContext.paymentMethodId);

    if (!contextHelper) {
        clearActivePreAuthorizationContext(req);
        return false;
    }

    context = contextHelper.getContext(req, activeContext.contextKey);
    cancelContext(context, contextHelper, 'detached active pre-authorization cleanup');
    contextHelper.clearContext(req, activeContext.contextKey);
    clearActivePreAuthorizationContext(req);

    return true;
}

/**
 * Cancels and clears a stored pre-authorization context before a basket payment
 * instrument exists, for example when SubmitPayment rejects a stale context.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} paymentMethodId - SFCC payment method id.
 * @param {string} contextKey - Stored context key.
 * @param {string} operationName - Functional context for logging.
 * @returns {boolean} True when a stored context was found and processed.
 */
function cleanupStoredPreAuthorizationContext(req, paymentMethodId, contextKey, operationName) {
    var contextHelper = getPreAuthorizationContextHelper(paymentMethodId);
    var normalizedContextKey = PayoneCommonUtils.trimString(contextKey, true);
    var context;

    if (!contextHelper || !normalizedContextKey) {
        return false;
    }

    context = contextHelper.getContext(req, normalizedContextKey);
    cancelContext(context, contextHelper, operationName || 'stored pre-authorization cleanup');
    contextHelper.clearContext(req, normalizedContextKey);
    clearActivePreAuthorizationContext(req);

    return !!context;
}

/**
 * Indicates whether the submitted PAYONE pre-authorization context no longer
 * matches the current basket state.
 *
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @returns {boolean} True when the existing PAYONE context is stale.
 */
function hasStalePaymentContext(currentBasket) {
    var paymentInstrument = getSubmittedPaymentInstrument(currentBasket);
    var paymentMethodId;
    var context;
    var customerOverride;

    if (!paymentInstrument) {
        return false;
    }

    paymentMethodId = typeof paymentInstrument.getPaymentMethod === 'function'
        ? paymentInstrument.getPaymentMethod()
        : paymentInstrument.paymentMethod;

    if (paymentMethodId === payonePayPalHelper.PAYMENT_METHOD_ID) {
        context = readPaymentInstrumentContext(paymentInstrument, 'payonePayPalPaymentContext');

        return !(
            context
            && context.approved
            && context.completed
            && payonePayPalHelper.isContextValidForBasket(context, currentBasket)
        );
    }

    if (paymentMethodId === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        context = readPaymentInstrumentContext(paymentInstrument, 'payoneSecureInstallmentContext');
        customerOverride = readPaymentInstrumentContext(paymentInstrument, 'payoneCustomerDataOverride');

        return !(
            context
            && payoneSecureInstallmentHelper.isContextValidForBasket(context, currentBasket, customerOverride)
            && payoneSecureInstallmentHelper.hasMatchingBillingAndShippingAddress(currentBasket, null)
        );
    }

    return false;
}

module.exports = {
    cleanupDetachedActivePreAuthorizationContext: cleanupDetachedActivePreAuthorizationContext,
    cleanupInvalidPaymentContexts: cleanupInvalidPaymentContexts,
    cleanupStoredPreAuthorizationContext: cleanupStoredPreAuthorizationContext,
    clearActivePreAuthorizationContext: clearActivePreAuthorizationContext,
    hasDetachedActivePreAuthorizationContext: hasDetachedActivePreAuthorizationContext,
    hasStalePaymentContext: hasStalePaymentContext,
    removeSubmittedPaymentInstrument: removeSubmittedPaymentInstrument,
    storeActivePreAuthorizationContext: storeActivePreAuthorizationContext
};
