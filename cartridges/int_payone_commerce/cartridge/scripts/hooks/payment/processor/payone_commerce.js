'use strict';

var collections = require('*/cartridge/scripts/util/collections');

var PaymentInstrument = require('dw/order/PaymentInstrument');
var Logger = require('dw/system/Logger');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');

var payoneCheckoutAuthorizationHelper = require('*/cartridge/scripts/payone/payoneCheckoutAuthorizationHelper');
var payoneCheckoutContextCleanupHelper = require('*/cartridge/scripts/payone/payoneCheckoutContextCleanupHelper');
var payonePayPalHelper = require('*/cartridge/scripts/payone/payonePayPalHelper');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');

var LOGGER = Logger.getLogger('payone', 'paymentHooks');

/**
 * Creates a PAYONE payment instrument and stores the method-specific authorization input on it.
 *
 * @param {dw.order.Basket} basket - Current basket.
 * @param {Object} paymentInformation - Submitted payment information.
 * @param {string} paymentMethodID - SFCC payment method identifier.
 * @param {Object} req - SFRA request object.
 * @returns {Object} SFRA payment hook result.
 */
function Handle(basket, paymentInformation, paymentMethodID, req) {
    var currentBasket = basket;
    var paymentInstruments = currentBasket.getPaymentInstruments();
    var giftCertificatePaymentInstruments = currentBasket.getGiftCertificatePaymentInstruments();
    var totalAmount = currentBasket.getTotalGrossPrice();
    var payoneInput = paymentInformation && paymentInformation.payonePaymentMethodSpecificInput;
    var payoneCustomerDataOverride = paymentInformation && paymentInformation.payoneCustomerDataOverride;
    var payonePayPalPaymentContext = paymentInformation && paymentInformation.payonePayPalPaymentContext;
    var payoneSecureInstallmentContext = paymentInformation && paymentInformation.payoneSecureInstallmentContext;
    var serverErrors = [];

    if (!payoneInput) {
        serverErrors.push(Resource.msg('error.payment.not.valid', 'checkout', null));
        return { fieldErrors: {}, serverErrors: serverErrors, error: true };
    }

    if (paymentMethodID === payonePayPalHelper.PAYMENT_METHOD_ID) {
        if (
            !payonePayPalPaymentContext
            || !payonePayPalPaymentContext.approved
            || !payonePayPalPaymentContext.completed
            || !payonePayPalHelper.isContextValidForBasket(payonePayPalPaymentContext, currentBasket)
        ) {
            serverErrors.push(Resource.msg('error.payment.not.valid', 'checkout', null));
            return { fieldErrors: {}, serverErrors: serverErrors, error: true };
        }
    }

    if (paymentMethodID === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        if (
            !payoneSecureInstallmentContext
            || !payoneSecureInstallmentHelper.isContextValidForBasket(
                payoneSecureInstallmentContext,
                currentBasket,
                payoneCustomerDataOverride
            )
        ) {
            serverErrors.push(Resource.msg('error.payment.not.valid', 'checkout', null));
            return { fieldErrors: {}, serverErrors: serverErrors, error: true };
        }
    }

    try {
        Transaction.wrap(function () {
            collections.forEach(paymentInstruments, function (item) {
                if (item.paymentMethod !== PaymentInstrument.METHOD_GIFT_CERTIFICATE) {
                    currentBasket.removePaymentInstrument(item);
                }
            });

            collections.forEach(giftCertificatePaymentInstruments, function (item) {
                if (item.paymentTransaction && item.paymentTransaction.amount) {
                    totalAmount = totalAmount.subtract(item.paymentTransaction.amount);
                }
            });

            var paymentInstrument = currentBasket.createPaymentInstrument(paymentMethodID, totalAmount);
            paymentInstrument.custom.payonePaymentMethodSpecificInput = JSON.stringify(payoneInput);
            paymentInstrument.custom.payoneCustomerDataOverride = payoneCustomerDataOverride
                ? JSON.stringify(payoneCustomerDataOverride)
                : null;
            paymentInstrument.custom.payonePayPalPaymentContext = payonePayPalPaymentContext
                ? JSON.stringify(payonePayPalPaymentContext)
                : null;
            paymentInstrument.custom.payoneSecureInstallmentContext = payoneSecureInstallmentContext
                ? JSON.stringify(payoneSecureInstallmentContext)
                : null;
        });

        if (paymentMethodID === payonePayPalHelper.PAYMENT_METHOD_ID) {
            payoneCheckoutContextCleanupHelper.storeActivePreAuthorizationContext(
                req,
                currentBasket,
                paymentMethodID,
                payonePayPalPaymentContext
            );
        } else if (paymentMethodID === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
            payoneCheckoutContextCleanupHelper.storeActivePreAuthorizationContext(
                req,
                currentBasket,
                paymentMethodID,
                payoneSecureInstallmentContext
            );
        } else {
            payoneCheckoutContextCleanupHelper.clearActivePreAuthorizationContext(req);
        }
    } catch (e) {
        LOGGER.error('PAYONE Handle failed: {0}. Stack: {1}', e.message, e.stack);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        return { fieldErrors: {}, serverErrors: serverErrors, error: true };
    }

    return { fieldErrors: {}, serverErrors: serverErrors, error: false };
}

/**
 * Authorizes the SFCC order through PAYONE by creating a commerce case and, when applicable, executing the payment.
 *
 * @param {string} orderNumber - The current order number.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Payment instrument to authorize.
 * @param {dw.order.PaymentProcessor} paymentProcessor - Payment processor for the current method.
 * @returns {Object} SFRA payment hook result.
 */
function Authorize(orderNumber, paymentInstrument, paymentProcessor) {
    var serverErrors = [];
    var result = payoneCheckoutAuthorizationHelper.authorize({
        orderNumber: orderNumber,
        paymentInstrument: paymentInstrument,
        paymentProcessor: paymentProcessor
    });

    if (result.error && result.errorMessage) {
        serverErrors.push(result.errorMessage);
    }

    return {
        fieldErrors: {},
        serverErrors: serverErrors,
        error: result.error
    };
}

exports.Handle = Handle;
exports.Authorize = Authorize;
