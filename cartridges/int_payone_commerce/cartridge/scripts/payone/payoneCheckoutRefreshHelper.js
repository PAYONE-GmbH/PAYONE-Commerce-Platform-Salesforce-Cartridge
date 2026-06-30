'use strict';

var URLUtils = require('dw/web/URLUtils');

var CHECKOUT_RETURN_ERROR_KEY = 'payoneCheckoutReturnError';
var SUBMIT_PAYMENT_REFRESH_KEY = 'payoneSubmitPaymentRefresh';
var PLACE_ORDER_REFRESH_KEY = 'payonePlaceOrderRefresh';

/**
 * Returns the shopper-facing checkout payment-stage URL.
 *
 * @returns {string} Checkout payment-stage URL.
 */
function getPaymentStageUrl() {
    return URLUtils.url('Checkout-Begin', 'stage', 'payment').toString();
}

/**
 * Returns the SFRA session privacy cache when available.
 *
 * @param {Object} req - SFRA request object.
 * @returns {Object|null} Session privacy cache or null.
 */
function getPrivacyCache(req) {
    return req && req.session && req.session.privacyCache ? req.session.privacyCache : null;
}

/**
 * Stores a one-shot checkout error message for the next Checkout-Begin render.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} message - User-facing error message.
 * @returns {void}
 */
function storeCheckoutReturnError(req, message) {
    var privacyCache = getPrivacyCache(req);

    if (privacyCache) {
        privacyCache.set(CHECKOUT_RETURN_ERROR_KEY, message);
    }
}

/**
 * Reads and clears the one-shot checkout return error message.
 *
 * @param {Object} req - SFRA request object.
 * @returns {string|null} User-facing error message or null.
 */
function consumeCheckoutReturnError(req) {
    var privacyCache = getPrivacyCache(req);
    var message = privacyCache ? privacyCache.get(CHECKOUT_RETURN_ERROR_KEY) : null;

    if (privacyCache && message) {
        privacyCache.set(CHECKOUT_RETURN_ERROR_KEY, null);
    }

    return message;
}

/**
 * Marks the current SubmitPayment failure as requiring a fresh payment-stage render.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} message - User-facing error message.
 * @returns {void}
 */
function markSubmitPaymentRefresh(req, message) {
    var privacyCache = getPrivacyCache(req);

    if (!privacyCache) {
        return;
    }

    storeCheckoutReturnError(req, message);
    privacyCache.set(SUBMIT_PAYMENT_REFRESH_KEY, true);
}

/**
 * Marks the current PlaceOrder failure as requiring a fresh payment-stage render.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} message - User-facing error message.
 * @returns {void}
 */
function markPlaceOrderRefresh(req, message) {
    var privacyCache = getPrivacyCache(req);

    if (!privacyCache) {
        return;
    }

    storeCheckoutReturnError(req, message);
    privacyCache.set(PLACE_ORDER_REFRESH_KEY, true);
}

/**
 * Adds SFRA-compatible redirect data to a stale PAYONE SubmitPayment error response.
 *
 * @param {Object} req - SFRA request object.
 * @param {Object} res - SFRA response object.
 * @param {Function} next - Next middleware callback.
 * @returns {*} Result of the next middleware.
 */
function applySubmitPaymentRefresh(req, res, next) {
    var privacyCache = getPrivacyCache(req);
    var shouldRefresh = privacyCache && privacyCache.get(SUBMIT_PAYMENT_REFRESH_KEY);
    var viewData = res.getViewData ? res.getViewData() : null;

    if (privacyCache && shouldRefresh) {
        privacyCache.set(SUBMIT_PAYMENT_REFRESH_KEY, null);
    }

    if (shouldRefresh && viewData && viewData.error) {
        viewData.cartError = true;
        viewData.redirectUrl = getPaymentStageUrl();
        res.setViewData(viewData);
    }

    return next();
}

/**
 * Adds SFRA-compatible redirect data to a stale PAYONE PlaceOrder error response.
 *
 * @param {Object} req - SFRA request object.
 * @param {Object} res - SFRA response object.
 * @param {Function} next - Next middleware callback.
 * @returns {*} Result of the next middleware.
 */
function applyPlaceOrderRefresh(req, res, next) {
    var privacyCache = getPrivacyCache(req);
    var shouldRefresh = privacyCache && privacyCache.get(PLACE_ORDER_REFRESH_KEY);
    var viewData = res.getViewData ? res.getViewData() : null;

    if (privacyCache && shouldRefresh) {
        privacyCache.set(PLACE_ORDER_REFRESH_KEY, null);
    }

    if (shouldRefresh && viewData && viewData.error) {
        viewData.cartError = true;
        viewData.redirectUrl = getPaymentStageUrl();
        res.setViewData(viewData);
    }

    return next();
}

module.exports = {
    applyPlaceOrderRefresh: applyPlaceOrderRefresh,
    applySubmitPaymentRefresh: applySubmitPaymentRefresh,
    consumeCheckoutReturnError: consumeCheckoutReturnError,
    getPaymentStageUrl: getPaymentStageUrl,
    markPlaceOrderRefresh: markPlaceOrderRefresh,
    markSubmitPaymentRefresh: markSubmitPaymentRefresh,
    storeCheckoutReturnError: storeCheckoutReturnError
};
