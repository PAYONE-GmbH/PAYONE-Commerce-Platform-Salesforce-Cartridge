'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var URLUtils = require('dw/web/URLUtils');
var Transaction = require('dw/system/Transaction');
var ApplePayHookResult = require('dw/extensions/applepay/ApplePayHookResult');

var payoneCommerceApplePayHelper = require('*/cartridge/scripts/helpers/payoneCommerceApplePayHelper');
var payoneCheckoutAuthorizationHelper = require('*/cartridge/scripts/payone/payoneCheckoutAuthorizationHelper');
var payonePaymentMethodSpecificInputBuilder = require('*/cartridge/scripts/payone/payonePaymentMethodSpecificInputBuilder');

var LOGGER = Logger.getLogger('payone', 'checkout');

/**
* Handles the Apple Pay request by updating session and response data based on checkout form settings.
*
* Sets session flags and modifies the responseData object to reflect whether shipping address,
* billing address, or shipping method should be required or provided by the checkout form.
*
* @param {dw.order.Basket} basket - The current basket object for the Apple Pay transaction.
* @param {Object} responseData - The response data object to be modified for Apple Pay.
* @returns {ApplePayHookResult} - The result object containing the status of the operation.
*/
exports.getRequest = function (basket, responseData) {
    session.custom.applepay = true;

    if (payoneCommerceApplePayHelper.useShippingAddressFromCheckoutForm) {
        responseData.requiredShippingContactFields = [];
    }

    if (payoneCommerceApplePayHelper.useBillingAddressFromCheckoutForm) {
        responseData.requiredBillingContactFields = [];
    }

    if (payoneCommerceApplePayHelper.useShippingMethodFromCheckoutForm) {
        responseData.shippingMethods = [];
    }

    return new ApplePayHookResult(new Status(Status.OK), null);
};

/**
* Handles the selection of a shipping contact during the Apple Pay checkout process.
* Optionally clears the available shipping methods in the response data if the configuration
* dictates using the shipping method from the checkout form. Returns an ApplePayHookResult
* indicating successful handling of the event.
*
* @param {dw.order.Basket} basket - The current basket object for the Apple Pay session.
* @param {Object} event - The Apple Pay shipping contact selection event data.
* @param {Object} responseData - The response data object to be modified with shipping methods.
* @returns {ApplePayHookResult} - Result object containing the status of the operation.
*/
exports.shippingContactSelected = function (basket, event, responseData) {
    if (payoneCommerceApplePayHelper.useShippingMethodFromCheckoutForm) {
        responseData.shippingMethods = [];
    }

    return new ApplePayHookResult(new Status(Status.OK), null);
};

/**
* Authorizes an Apple Pay payment for the given order using PAYONE integration.
*
* This function retrieves the payment method and processor, builds the Apple Pay-specific input,
* updates the payment instrument, and attempts to authorize the payment via the PAYONE checkout
* authorization helper. It handles errors gracefully and logs any exceptions encountered during
* the process.
*
* @param {dw.order.Order} order - The order object for which payment authorization is performed.
* @param {Object} responseData - The response data containing the Apple Pay payment token.
* @returns {dw.system.Status} - The status of the authorization process (OK or ERROR).
*/
exports.authorizeOrderPayment = function (order, responseData) {
    var status = Status.ERROR;
    var paymentMethod = require('dw/order/PaymentMgr').getPaymentMethod(payoneCommerceApplePayHelper.PAYMENT_METHOD_ID);

    try {
        var paymentInstrument = null;
        var paymentInstruments = order.getPaymentInstruments();
        if (!paymentMethod || empty(paymentInstruments) || !paymentInstruments.length) {
            return new Status(status);
        }

        var paymentProcessor = paymentMethod.getPaymentProcessor();
        var paymentMethodSpecificInput = payonePaymentMethodSpecificInputBuilder.buildApplePaySpecificInput(order, responseData.payment.token) || {};

        Transaction.wrap(function () {
            paymentInstrument = paymentInstruments[0];
            paymentInstrument.paymentTransaction.paymentProcessor = paymentProcessor;
            paymentInstrument.custom.payonePaymentMethodSpecificInput = JSON.stringify(paymentMethodSpecificInput);
        });

        var helperResult = payoneCheckoutAuthorizationHelper.authorize({
            orderNumber: order.orderNo,
            paymentInstrument: paymentInstrument,
            paymentProcessor: paymentProcessor
        });

        if (!helperResult.error) {
            status = Status.OK;
        }
    } catch (e) {
        LOGGER.error(
            'PAYONE Apple Pay authorization error. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
    }

    return new Status(status);
};

/**
* Places an order and returns the result for Apple Pay integration.
*
* @param {dw.order.Order} order - The order object to be placed.
* @returns {ApplePayHookResult} - The result object containing the status and confirmation URL for Apple Pay.
*/
exports.placeOrder = function (order) {
    var paymentInstruments = order.getPaymentInstruments();
    var paymentInstrument = paymentInstruments.length ? paymentInstruments[0] : null;

    var postRedirectReturnNonce = payoneCheckoutAuthorizationHelper.ensurePostRedirectReturnNonce(paymentInstrument) || "";

    return new ApplePayHookResult(new Status(Status.OK), URLUtils.url('PayoneCommerce-OrderConfirm', 'orderNo', order.orderNo, 'nonce', postRedirectReturnNonce));
};

/**
* Handles the cancellation of the Apple Pay process.
* Returns to the previous screen without performing a redirect.
*
* @returns {ApplePayHookResult} Result object indicating successful cancellation with status OK.
*/
exports.cancel = function () {
    return new ApplePayHookResult(new Status(Status.OK), null);
};
