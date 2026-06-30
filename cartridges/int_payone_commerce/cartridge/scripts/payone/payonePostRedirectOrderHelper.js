'use strict';

var server = require('server');
var Order = require('dw/order/Order');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');

var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');
var payoneCard3DSHelper = require('*/cartridge/scripts/payone/payoneCard3DSHelper');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');

var POST_REDIRECT_CONFIRMATION_ORDER_KEY = 'payonePostRedirectConfirmationOrderNo';
var POST_REDIRECT_CONFIRMATION_ORDER_TOKEN_KEY = 'payonePostRedirectConfirmationOrderToken';

/**
 * Indicates whether the order belongs to the current shopper session.
 *
 * @param {Object} req - Current request.
 * @param {dw.order.Order} order - Order to check.
 * @returns {boolean} True when the order belongs to the current customer.
 */
function isCurrentCustomerOrder(req, order) {
    var currentCustomer = req && req.currentCustomer && req.currentCustomer.raw;

    return !!(order && currentCustomer && order.customer && order.customer.ID === currentCustomer.ID);
}

/**
 * Stores the finalized 3DS order lookup data in the current session so the confirmation page can be refreshed safely.
 *
 * @param {Object} req - Current request.
 * @param {dw.order.Order} order - Finalized order.
 * @returns {void}
 */
function storePostRedirectConfirmationOrder(req, order) {
    var orderToken = order && typeof order.getOrderToken === 'function' ? order.getOrderToken() : null;

    if (req && req.session && req.session.privacyCache && order && order.orderNo && orderToken) {
        req.session.privacyCache.set(POST_REDIRECT_CONFIRMATION_ORDER_KEY, order.orderNo);
        req.session.privacyCache.set(POST_REDIRECT_CONFIRMATION_ORDER_TOKEN_KEY, orderToken);
    }
}

/**
 * Returns the finalized 3DS order number stored for the current session.
 *
 * @param {Object} req - Current request.
 * @returns {string|null} Stored order number or null.
 */
function getPostRedirectConfirmationOrderNo(req) {
    if (!(req && req.session && req.session.privacyCache)) {
        return null;
    }

    return req.session.privacyCache.get(POST_REDIRECT_CONFIRMATION_ORDER_KEY) || null;
}

/**
 * Returns the finalized 3DS order token stored for the current session.
 *
 * @param {Object} req - Current request.
 * @returns {string|null} Stored order token or null.
 */
function getPostRedirectConfirmationOrderToken(req) {
    if (!(req && req.session && req.session.privacyCache)) {
        return null;
    }

    return req.session.privacyCache.get(POST_REDIRECT_CONFIRMATION_ORDER_TOKEN_KEY) || null;
}

/**
 * Returns the finalized 3DS order stored for the current session using SFCC's token-protected lookup.
 *
 * @param {Object} req - Current request.
 * @returns {dw.order.Order|null} Stored order or null.
 */
function getPostRedirectConfirmationOrder(req) {
    var orderNo = getPostRedirectConfirmationOrderNo(req);
    var orderToken = getPostRedirectConfirmationOrderToken(req);

    return orderNo && orderToken ? OrderMgr.getOrder(orderNo, orderToken) : null;
}

/**
 * Indicates whether the order is the finalized 3DS order stored for this session.
 *
 * @param {Object} req - Current request.
 * @param {dw.order.Order} order - Order to check.
 * @returns {boolean} True when the order can be shown on the stable confirmation page.
 */
function isStoredPostRedirectConfirmationOrder(req, order) {
    var storedOrderNo = getPostRedirectConfirmationOrderNo(req);
    var storedOrderToken = getPostRedirectConfirmationOrderToken(req);
    var orderToken = order && typeof order.getOrderToken === 'function' ? order.getOrderToken() : null;

    return !!(
        storedOrderNo
        && storedOrderToken
        && order
        && order.orderNo === storedOrderNo
        && orderToken === storedOrderToken
        && order.status.value !== Order.ORDER_STATUS_CREATED
        && isCurrentCustomerOrder(req, order)
    );
}

/**
 * Renders the SFRA confirmation page with the view data needed by guest account creation and consent templates.
 *
 * @param {dw.order.Order} order - Finalized order.
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @returns {void}
 */
function renderConfirmation(order, req, res) {
    var passwordForm;

    if (!req.currentCustomer.profile) {
        passwordForm = server.forms.getForm('newPasswords');
        passwordForm.clear();
    }

    res.render(
        'checkout/confirmation/confirmation',
        payoneCard3DSHelper.buildConfirmationViewData(order, req, passwordForm)
    );
}

/**
 * Handles the PAYONE return from a post-redirect payment flow and finalizes the SFCC order when possible.
 *
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @param {Function} next - Next middleware function.
 * @returns {Object} Result of next().
 */
function handlePostRedirectOrderConfirmation(req, res, next) {
    var orderNo = req.querystring.orderNo;
    var returnNonce = req.querystring.nonce;
    var order;
    var paymentInstrument;
    var paymentTransaction;
    var commerceCaseId;
    var checkoutId;
    var paymentExecutionId;
    var getResult;
    var checkout;

    if (!orderNo || !returnNonce) {
        res.render('/error', {
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        });
        return next();
    }

    order = OrderMgr.getOrder(orderNo);

    if (!order) {
        res.render('/error', {
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        });
        return next();
    }

    if (!isCurrentCustomerOrder(req, order)) {
        res.render('/error', {
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        });
        return next();
    }

    paymentInstrument = payoneCard3DSHelper.getPayonePaymentInstrument(order);
    paymentTransaction = paymentInstrument && paymentInstrument.paymentTransaction;
    commerceCaseId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payoneCommerceCaseId');
    checkoutId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payoneCheckoutId');
    paymentExecutionId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payonePaymentExecutionId');

    if (!paymentInstrument || !commerceCaseId || !payoneCard3DSHelper.isValidReturnNonce(paymentTransaction, returnNonce)) {
        if (isStoredPostRedirectConfirmationOrder(req, order)) {
            res.redirect(URLUtils.url('PayoneCommerce-PostRedirectOrderConfirm').toString());
            return next();
        }

        res.render('/error', {
            message: Resource.msg('error.payment.not.valid', 'checkout', null)
        });
        return next();
    }

    getResult = commerceCaseService.get(commerceCaseId, {});

    if (!getResult.ok) {
        res.render('/error', {
            message: getResult.userMessage || Resource.msg('error.technical', 'checkout', null)
        });
        return next();
    }

    checkout = payoneCheckoutStateHelper.getCheckout(getResult, checkoutId);

    if (!checkout || !payoneCheckoutStateHelper.getPaymentExecution(checkout, paymentExecutionId)) {
        res.render('/error', {
            message: Resource.msg('error.payment.not.valid', 'checkout', null)
        });
        return next();
    }

    payoneCard3DSHelper.updatePaymentTransactionStatus(paymentTransaction, checkout, paymentExecutionId);

    if (payoneCheckoutStateHelper.isRejected(checkout, paymentExecutionId)) {
        Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
        });
        req.session.privacyCache.set(
            'payoneCheckoutReturnError',
            Resource.msg('payone.error.payment_declined', 'payoneError', null)
        );
        payoneCard3DSHelper.clearRedirectState(paymentTransaction);

        res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'payment').toString());
        return next();
    }

    if (payoneCheckoutStateHelper.isSuccessfulPostRedirectState(checkout, paymentExecutionId)) {
        if (order.status.value === Order.ORDER_STATUS_CREATED && !payoneCard3DSHelper.finalizeOrder(order, req)) {
            res.render('/error', {
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        storePostRedirectConfirmationOrder(req, order);
        payoneCard3DSHelper.clearRedirectState(paymentTransaction);
        res.redirect(URLUtils.url('PayoneCommerce-PostRedirectOrderConfirm').toString());
        return next();
    }

    res.render('/error', {
        message: Resource.msg('error.payment.not.valid', 'checkout', null)
    });
    return next();
}

/**
 * Renders the stable confirmation page for a finalized 3DS order stored in this session.
 *
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @param {Function} next - Next middleware function.
 * @returns {Object} Result of next().
 */
function renderPostRedirectOrderConfirmation(req, res, next) {
    var order = getPostRedirectConfirmationOrder(req);

    if (!isStoredPostRedirectConfirmationOrder(req, order)) {
        res.render('/error', {
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        });
        return next();
    }

    renderConfirmation(order, req, res);
    return next();
}

module.exports = {
    handlePostRedirectOrderConfirmation: handlePostRedirectOrderConfirmation,
    renderPostRedirectOrderConfirmation: renderPostRedirectOrderConfirmation
};
