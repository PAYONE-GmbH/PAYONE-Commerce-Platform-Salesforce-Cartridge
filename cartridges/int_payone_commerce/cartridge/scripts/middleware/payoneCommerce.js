'use strict';

var server = require('server');
var payoneCommerceCheckoutHelper = require("*/cartridge/scripts/helpers/payoneCommerceCheckoutHelper.js");

/**
 * Cancels PAYONE pre-authorization contexts when native SFRA payment validation
 * is about to reject the selected basket payment instrument.
 *
 * @param {Object} req - SFRA request object.
 * @param {Object} res - SFRA response object.
 * @param {Function} next - Next middleware callback.
 * @returns {*} Result of the next middleware.
 */
function cleanupInvalidPaymentContexts(req, res, next) {
    var BasketMgr = require('dw/order/BasketMgr');
    var Resource = require('dw/web/Resource');
    var Transaction = require('dw/system/Transaction');
    var basketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
    var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
    var payoneCheckoutRefreshHelper = require('*/cartridge/scripts/payone/payoneCheckoutRefreshHelper');
    var payoneCheckoutContextCleanupHelper = require('*/cartridge/scripts/payone/payoneCheckoutContextCleanupHelper');

    var currentBasket = BasketMgr.getCurrentBasket();
    var invalidPaymentMessage = Resource.msg('error.payment.not.valid', 'checkout', null);
    var hasStalePaymentContext;
    var hasDetachedActivePreAuthorizationContext;
    var validPayment;

    if (!currentBasket || !currentBasket.billingAddress) {
        return next();
    }

    Transaction.wrap(function () {
        basketCalculationHelpers.calculateTotals(currentBasket);
    });

    hasStalePaymentContext = payoneCheckoutContextCleanupHelper.hasStalePaymentContext(currentBasket);
    hasDetachedActivePreAuthorizationContext = payoneCheckoutContextCleanupHelper.hasDetachedActivePreAuthorizationContext(
        req,
        currentBasket
    );

    if (hasStalePaymentContext || hasDetachedActivePreAuthorizationContext) {
        if (hasStalePaymentContext) {
            payoneCheckoutContextCleanupHelper.cleanupInvalidPaymentContexts(req, currentBasket);
            payoneCheckoutContextCleanupHelper.removeSubmittedPaymentInstrument(currentBasket);
        }

        if (hasDetachedActivePreAuthorizationContext) {
            payoneCheckoutContextCleanupHelper.cleanupDetachedActivePreAuthorizationContext(req);
        }

        payoneCheckoutRefreshHelper.markPlaceOrderRefresh(req, invalidPaymentMessage);
        return next();
    }

    validPayment = COHelpers.validatePayment(req, currentBasket);

    if (validPayment.error) {
        payoneCheckoutContextCleanupHelper.cleanupInvalidPaymentContexts(req, currentBasket);
    }

    return next();
}

/**
* Initializes and clears payment forms for all applicable payment methods in the current order's billing data.
*
* Iterates through each applicable payment method, retrieves the corresponding form using the helper mapping,
* clears the form, and attaches it to the view data for rendering in the response.
*
* @param {Object} req - The HTTP request object.
* @param {Object} res - The HTTP response object, expected to contain view data with order and payment information.
* @param {Function} next - The callback to pass control to the next middleware function.
*/
function initializeForms(req, res, next) {
    var viewData = res.getViewData();

    if (
        viewData &&
        viewData.order &&
        viewData.order.billing &&
        viewData.order.billing.payment &&
        viewData.order.billing.payment.applicablePaymentMethods
    ) {
        var applicableMethods = viewData.order.billing.payment.applicablePaymentMethods;

        applicableMethods.forEach(function (method) {
            // method.ID comes from SFCC applicablePaymentMethods
            var formName = payoneCommerceCheckoutHelper.forms[method.ID];

            if (formName) {
                var form = server.forms.getForm(formName);
                if (form) {
                    form.clear();
                    viewData.forms[formName] = form;
                }
            }
        });
    }

    next();
}

/**
 * Transfers a PAYONE post-redirect checkout error message from the session
 * privacy cache into the checkout view data so it can be shown once on the
 * payment step after the shopper is redirected back, then clears the cached
 * message to avoid showing the same error again on refresh.
 *
 * @param {Object} req - SFRA request object.
 * @param {Object} res - SFRA response object.
 * @param {Function} next - Next middleware callback.
 * @returns {*} Result of the next middleware.
 */
function checkoutReturnErrors(req, res, next) {
    var payoneCheckoutRefreshHelper = require('*/cartridge/scripts/payone/payoneCheckoutRefreshHelper');
    var viewData = res.getViewData() || {};
    var payoneCheckoutReturnError = payoneCheckoutRefreshHelper.consumeCheckoutReturnError(req);

    if (payoneCheckoutReturnError) {
        viewData.errorMessage = payoneCheckoutReturnError;
        res.setViewData(viewData);
    }

    return next();
}

module.exports = {
    initializeForms: initializeForms,
    checkoutReturnErrors: checkoutReturnErrors,
    cleanupInvalidPaymentContexts: cleanupInvalidPaymentContexts
};
