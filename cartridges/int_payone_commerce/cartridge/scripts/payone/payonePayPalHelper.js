'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Logger = require('dw/system/Logger');
var URLUtils = require('dw/web/URLUtils');
var UUIDUtils = require('dw/util/UUIDUtils');

var CreateCheckoutRequest = require('*/cartridge/scripts/models/payone/CreateCheckoutRequest');
var Customer = require('*/cartridge/scripts/models/payone/Customer');
var OrderRequest = require('*/cartridge/scripts/models/payone/OrderRequest');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneCheckoutFingerprintHelper = require('*/cartridge/scripts/payone/payoneCheckoutFingerprintHelper');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');

var LOGGER = Logger.getLogger('payone', 'paypal');
var PAYMENT_METHOD_ID = 'PAYONE_COMMERCE_PAYPAL';
var PAYMENT_PRODUCT_ID = 840;
var SESSION_KEY_PREFIX = 'pPP_';

/**
 * Returns the current basket when available.
 *
 * @returns {dw.order.Basket|null} Current basket.
 */
function getCurrentBasket() {
    return BasketMgr.getCurrentBasket();
}

/**
 * Reads a JSON object from the session privacy cache.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} key - Cache key.
 * @returns {Object|null} Parsed JSON object or null.
 */
function getCachedObject(req, key) {
    var value;

    if (!req || !req.session || !req.session.privacyCache || !key) {
        return null;
    }

    value = req.session.privacyCache.get(key);

    return value ? PayoneCommonUtils.parseJson(value) : null;
}

/**
 * Writes a JSON-serializable object to the session privacy cache.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} key - Cache key.
 * @param {Object|null} value - JSON-serializable value.
 * @returns {undefined}
 */
function setCachedObject(req, key, value) {
    if (!req || !req.session || !req.session.privacyCache || !key) {
        return;
    }

    req.session.privacyCache.set(key, value ? JSON.stringify(value) : null);
}

/**
 * Builds the SHA-256 fingerprint hash for a basket.
 *
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @returns {string|null} Fingerprint hash.
 */
function buildBasketFingerprintHash(basket) {
    return payoneCheckoutFingerprintHelper.buildFingerprintHash(
        basket,
        'basket',
        {
            paymentMethodId: PAYMENT_METHOD_ID,
            basketUUID: basket && basket.UUID ? basket.UUID : null
        },
        LOGGER,
        'PAYONE PayPal'
    );
}

/**
 * Builds the SHA-256 fingerprint hash for an order.
 *
 * @param {dw.order.Order|Object} order - Created order.
 * @param {string|null} basketUUID - Original basket UUID.
 * @returns {string|null} Fingerprint hash.
 */
function buildOrderFingerprintHash(order, basketUUID) {
    return payoneCheckoutFingerprintHelper.buildFingerprintHash(
        order,
        'order',
        {
            paymentMethodId: PAYMENT_METHOD_ID,
            basketUUID: basketUUID
        },
        LOGGER,
        'PAYONE PayPal'
    );
}

/**
 * Compares two PayPal checkout fingerprint hashes.
 *
 * @param {string|null} left - First fingerprint hash.
 * @param {string|null} right - Second fingerprint hash.
 * @returns {boolean} True when both hashes match.
 */
function isSameFingerprint(left, right) {
    if (!left || !right) {
        return false;
    }

    return left === right;
}

/**
 * Builds the PAYONE redirect input for PayPal JavaScript SDK flow.
 *
 * @returns {Object} PAYONE payment-method specific input payload.
 */
function buildPayPalPaymentMethodSpecificInput() {
    var returnUrl;

    try {
        returnUrl = URLUtils.https('PayoneCommerce-PaypalReturn').toString();
    } catch (e) {
        returnUrl = null;
    }

    return {
        redirectPaymentMethodSpecificInput: {
            paymentProductId: PAYMENT_PRODUCT_ID,
            paymentProduct840SpecificInput: {
                javaScriptSdkFlow: true
            },
            redirectionData: {
                returnUrl: returnUrl
            }
        }
    };
}

/**
 * Builds a PAYONE commerce-case create request body for a basket-backed PayPal attempt.
 *
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {string} reservedOrderNo - Reserved SFCC order number.
 * @returns {Object} PAYONE create-commerce-case request payload.
 */
function buildCreateRequestBodyFromBasket(basket, reservedOrderNo) {
    var commerceCaseReference = payoneMerchantReferenceHelper.buildCommerceCaseReference(reservedOrderNo);
    var checkoutReference = payoneMerchantReferenceHelper.buildCheckoutReference(reservedOrderNo);
    var paymentReference = payoneMerchantReferenceHelper.buildPaymentReference(reservedOrderNo);
    var customerModel = Customer.fromBasket(basket);
    var checkoutModel = CreateCheckoutRequest.fromBasket(basket, new OrderRequest({
        orderReferences: {
            merchantReference: paymentReference
        },
        paymentMethodSpecificInput: buildPayPalPaymentMethodSpecificInput()
    }));
    var checkoutRequest = checkoutModel.toRequest();

    checkoutRequest.references = checkoutRequest.references || {};
    checkoutRequest.references.merchantReference = checkoutReference;

    return {
        merchantReference: commerceCaseReference,
        customer: customerModel.toRequest(),
        checkout: checkoutRequest
    };
}

/**
 * Extracts the PAYONE PayPal transaction id from a create/complete/get response.
 *
 * @param {Object} response - PAYONE response object.
 * @param {string} paymentExecutionId - Expected payment execution id.
 * @returns {string|null} PayPal transaction id or null.
 */
function getPayPalTransactionId(response, paymentExecutionId) {
    var checkout = payoneCheckoutStateHelper.getCheckout(response);
    var paymentExecution = payoneCheckoutStateHelper.getPaymentExecution(checkout, paymentExecutionId);
    var payment = checkout && checkout.paymentResponse && checkout.paymentResponse.payment;
    var paymentOutput = payment && payment.paymentOutput;
    var redirectOutput = paymentOutput && paymentOutput.redirectPaymentMethodSpecificOutput;
    var paymentExecutionOutput = paymentExecution && paymentExecution.payment;
    var paymentExecutionPaymentOutput = paymentExecutionOutput && paymentExecutionOutput.paymentOutput;
    var paymentExecutionRedirectOutput = paymentExecutionPaymentOutput && paymentExecutionPaymentOutput.redirectPaymentMethodSpecificOutput;

    return PayoneCommonUtils.trimString(
        redirectOutput
            && redirectOutput.paymentProduct840SpecificOutput
            && redirectOutput.paymentProduct840SpecificOutput.payPalTransactionId,
        true
    ) || PayoneCommonUtils.trimString(
        paymentExecutionRedirectOutput
            && paymentExecutionRedirectOutput.paymentProduct840SpecificOutput
            && paymentExecutionRedirectOutput.paymentProduct840SpecificOutput.payPalTransactionId,
        true
    ) || null;
}

/**
 * Builds and stores a new server-side PayPal context for the current basket.
 *
 * @param {Object} req - SFRA request object.
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {Object} createResult - PAYONE create response.
 * @param {string} reservedOrderNo - Reserved SFCC order number.
 * @returns {Object|null} Stored context or null.
 */
function storeCreateContext(req, basket, createResult, reservedOrderNo) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);
    var paymentExecution = payoneCheckoutStateHelper.getPaymentExecution(checkout);
    var contextKey = UUIDUtils.createUUID().replace(/-/g, '');
    var context;

    if (!(checkout && checkout.checkoutId && paymentExecution && paymentExecution.paymentExecutionId)) {
        return null;
    }

    context = {
        contextKey: contextKey,
        basketUUID: basket && basket.UUID ? basket.UUID : null,
        merchantReference: payoneMerchantReferenceHelper.buildCheckoutReference(reservedOrderNo),
        commerceCaseId: createResult && createResult.data ? createResult.data.commerceCaseId : null,
        checkoutId: checkout.checkoutId,
        paymentExecutionId: paymentExecution.paymentExecutionId,
        payPalTransactionId: getPayPalTransactionId(createResult, paymentExecution.paymentExecutionId),
        checkoutFingerprintHash: buildBasketFingerprintHash(basket),
        approved: false,
        completed: false,
        checkoutPaymentStatus: payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout),
        latestPaymentEventStatus: payoneCheckoutStateHelper.getLatestPaymentEventStatus(checkout, paymentExecution.paymentExecutionId) || null
    };

    if (!context.payPalTransactionId) {
        LOGGER.error(
            'PAYONE PayPal create response is missing payPalTransactionId for basket {0}.',
            context.basketUUID || 'unknown'
        );
        return null;
    }
    if (!context.checkoutFingerprintHash) {
        LOGGER.error(
            'PAYONE PayPal checkout fingerprint could not be built for basket {0}.',
            context.basketUUID || 'unknown'
        );
        return null;
    }

    setCachedObject(req, SESSION_KEY_PREFIX + contextKey, context);

    return context;
}

/**
 * Loads the server-side PayPal context for the given key.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} contextKey - Context key returned to the browser.
 * @returns {Object|null} Stored context or null.
 */
function getContext(req, contextKey) {
    return getCachedObject(req, SESSION_KEY_PREFIX + PayoneCommonUtils.trimString(contextKey, true));
}

/**
 * Updates an existing server-side PayPal context.
 *
 * @param {Object} req - SFRA request object.
 * @param {Object} context - Updated context payload.
 * @returns {undefined}
 */
function saveContext(req, context) {
    if (!context || !context.contextKey) {
        return;
    }

    setCachedObject(req, SESSION_KEY_PREFIX + context.contextKey, context);
}

/**
 * Deletes a server-side PayPal context.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} contextKey - Context key.
 * @returns {undefined}
 */
function clearContext(req, contextKey) {
    setCachedObject(req, SESSION_KEY_PREFIX + PayoneCommonUtils.trimString(contextKey, true), null);
}

/**
 * Validates that the stored PayPal context still matches the current basket.
 *
 * @param {Object} context - Stored server-side context.
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @returns {boolean} True when the context still matches the basket state.
 */
function isContextValidForBasket(context, basket) {
    return !!(
        context
        && context.basketUUID
        && basket
        && context.basketUUID === basket.UUID
        && isSameFingerprint(context.checkoutFingerprintHash, buildBasketFingerprintHash(basket))
    );
}

/**
 * Validates that the stored PayPal context still matches the created order state.
 *
 * @param {Object} context - Stored server-side context.
 * @param {dw.order.Order|Object} order - Created order.
 * @returns {boolean} True when the context still matches the order state.
 */
function isContextValidForOrder(context, order) {
    return isSameFingerprint(
        context && context.checkoutFingerprintHash,
        buildOrderFingerprintHash(order, context && context.basketUUID ? context.basketUUID : null)
    );
}

/**
 * Loads the latest PAYONE checkout state for the given commerce case.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {string} checkoutId - PAYONE checkout UUID.
 * @returns {{getResult:Object, checkout:(Object|null)}} Latest state result.
 */
function getCheckoutState(commerceCaseId, checkoutId) {
    var getResult;
    var checkout;

    getResult = commerceCaseService.get(commerceCaseId, {});
    checkout = payoneCheckoutStateHelper.getCheckout(getResult, checkoutId);

    return {
        getResult: getResult,
        checkout: checkout
    };
}

module.exports = {
    PAYMENT_METHOD_ID: PAYMENT_METHOD_ID,
    PAYMENT_PRODUCT_ID: PAYMENT_PRODUCT_ID,
    buildBasketFingerprintHash: buildBasketFingerprintHash,
    buildCreateRequestBodyFromBasket: buildCreateRequestBodyFromBasket,
    buildPayPalPaymentMethodSpecificInput: buildPayPalPaymentMethodSpecificInput,
    clearContext: clearContext,
    getCheckoutState: getCheckoutState,
    getContext: getContext,
    getCurrentBasket: getCurrentBasket,
    getPayPalTransactionId: getPayPalTransactionId,
    isContextValidForBasket: isContextValidForBasket,
    isContextValidForOrder: isContextValidForOrder,
    saveContext: saveContext,
    storeCreateContext: storeCreateContext
};
