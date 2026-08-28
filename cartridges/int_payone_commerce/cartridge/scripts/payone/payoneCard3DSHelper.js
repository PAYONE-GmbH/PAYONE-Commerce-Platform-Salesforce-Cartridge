'use strict';

var Logger = require('dw/system/Logger');
var Transaction = require('dw/system/Transaction');
var Locale = require('dw/util/Locale');

var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var addressHelpers = require('*/cartridge/scripts/helpers/addressHelpers');
var OrderModel = require('*/cartridge/models/order');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var reportingUrlsHelper = require('*/cartridge/scripts/reportingUrls');

var readCustomAttribute = PayoneCommonUtils.readCustomAttribute;
var LOGGER = Logger.getLogger('payone', 'checkout');

/**
 * Returns the PAYONE payment instrument stored on the order.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @returns {dw.order.PaymentInstrument|Object|null} Matching PAYONE payment instrument.
 */
function getPayonePaymentInstrument(order) {
    var paymentInstruments = order && order.paymentInstruments ? order.paymentInstruments : [];
    var i;

    for (i = 0; i < paymentInstruments.length; i += 1) {
        if (readCustomAttribute(paymentInstruments[i] && paymentInstruments[i].paymentTransaction, 'payoneCommerceCaseId')) {
            return paymentInstruments[i];
        }
    }

    return null;
}

/**
 * Builds the standard SFRA confirmation page view data for a finalized order.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @param {Object} req - Current SFRA request.
 * @param {Object|null} passwordForm - Guest password form when needed.
 * @returns {{order:Object, returningCustomer:boolean, reportingURLs:Array, orderUUID:string, passwordForm:(Object|null)}} Confirmation view data.
 */
function getConfirmationViewData(order, req, passwordForm) {
    var config = {
        numberOfLineItems: '*'
    };
    var currentLocale = Locale.getLocale(req.locale.id);

    return {
        order: new OrderModel(
            order,
            { config: config, countryCode: currentLocale.country, containerView: 'order' }
        ),
        returningCustomer: !!req.currentCustomer.profile,
        reportingURLs: reportingUrlsHelper.getOrderReportingURLs(order),
        orderUUID: typeof order.getUUID === 'function' ? order.getUUID() : null,
        passwordForm: passwordForm || null
    };
}

/**
 * Saves the latest PAYONE checkout-level/payment-event statuses and redirect URL on the payment transaction.
 *
 * @param {dw.order.PaymentTransaction|Object} paymentTransaction - Payment transaction to update.
 * @param {Object|null} checkout - PAYONE checkout payload.
 * @param {string} [paymentExecutionId] - PAYONE payment execution identifier.
 * @returns {void}
 */
function updatePaymentTransactionStatus(paymentTransaction, checkout, paymentExecutionId) {
    var checkoutPaymentStatus = payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout);
    var latestPaymentEventStatus = payoneCheckoutStateHelper.getLatestPaymentEventStatus(checkout, paymentExecutionId);

    if (!paymentTransaction) {
        return;
    }

    Transaction.wrap(function () {
        try {
            paymentTransaction.custom.payoneCheckoutPaymentStatus = checkoutPaymentStatus || null;
            paymentTransaction.custom.payoneLatestPaymentEventStatus = latestPaymentEventStatus || null;
            paymentTransaction.custom.payoneRedirectUrl = payoneCheckoutStateHelper.getRedirectUrl(checkout) || null;
        } catch (e) {
            LOGGER.error(
                'PAYONE payment status could not be updated on payment transaction. Error: {0}. Stack: {1}',
                e.message,
                e.stack
            );
        }
    });
}

/**
 * Clears transient PAYONE post-redirect state once the return flow has ended.
 *
 * @param {dw.order.PaymentTransaction|Object} paymentTransaction - Payment transaction to update.
 * @returns {void}
 */
function clearRedirectState(paymentTransaction) {
    if (!paymentTransaction) {
        return;
    }

    Transaction.wrap(function () {
        try {
            paymentTransaction.custom.payoneRedirectUrl = null;
            paymentTransaction.custom.payonePostRedirectReturnNonce = null;
        } catch (e) {
            LOGGER.error(
                'PAYONE post-redirect state could not be cleared from payment transaction. Error: {0}. Stack: {1}',
                e.message,
                e.stack
            );
        }
    });
}

/**
 * Validates the nonce returned from PAYONE against the stored post-redirect payment attempt value.
 *
 * @param {dw.order.PaymentTransaction|Object} paymentTransaction - Payment transaction containing the stored nonce.
 * @param {string} providedNonce - Nonce returned in the shopper request.
 * @returns {boolean} True when the nonce matches the stored payment attempt.
 */
function isValidReturnNonce(paymentTransaction, providedNonce) {
    var storedNonce = readCustomAttribute(paymentTransaction, 'payonePostRedirectReturnNonce');

    return !!(storedNonce && providedNonce && storedNonce === providedNonce);
}

/**
 * Finalizes the SFCC order after PAYONE confirms the post-redirect payment state is successful.
 *
 * @param {dw.order.Order} order - Order to finalize.
 * @param {Object} req - Current SFRA request.
 * @returns {boolean} True when the order was placed successfully.
 */
function finalizeOrder(order, req) {
    var placeOrderResult = COHelpers.placeOrder(order, {
        status: 'success'
    });

    if (placeOrderResult.error) {
        return false;
    }

    if (req.currentCustomer.addressBook) {
        addressHelpers.gatherShippingAddresses(order).forEach(function (address) {
            if (!addressHelpers.checkIfAddressStored(address, req.currentCustomer.addressBook.addresses)) {
                addressHelpers.saveAddress(address, req.currentCustomer, addressHelpers.generateAddressName(address));
            }
        });
    }

    if (order.getCustomerEmail()) {
        COHelpers.sendConfirmationEmail(order, req.locale.id);
    }

    req.session.privacyCache.set('usingMultiShipping', false);

    return true;
}

module.exports = {
    buildConfirmationViewData: getConfirmationViewData,
    clearRedirectState: clearRedirectState,
    finalizeOrder: finalizeOrder,
    getPayonePaymentInstrument: getPayonePaymentInstrument,
    isValidReturnNonce: isValidReturnNonce,
    readCustomAttribute: readCustomAttribute,
    updatePaymentTransactionStatus: updatePaymentTransactionStatus
};
