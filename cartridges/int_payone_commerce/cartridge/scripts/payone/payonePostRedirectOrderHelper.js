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
 * Stores the finalized post-redirect order lookup data in the current session so the confirmation page can be refreshed safely.
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
 * Returns the finalized post-redirect order number stored for the current session.
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
 * Returns the finalized post-redirect order token stored for the current session.
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
 * Returns the finalized post-redirect order stored for the current session using SFCC's token-protected lookup.
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
 * Indicates whether the order is the finalized post-redirect order stored for this session.
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
 * Resolves and applies the latest PAYONE post-redirect payment state.
 *
 * @param {Object} req - Current request.
 * @param {string} orderNo - SFCC order number.
 * @param {string} returnNonce - Post-redirect return nonce.
 * @returns {{status:string, redirectUrl:(string|null), message:(string|null)}} Resolution result.
 */
function resolvePostRedirectOrder(req, orderNo, returnNonce) {
    var order;
    var paymentInstrument;
    var paymentTransaction;
    var commerceCaseId;
    var checkoutId;
    var paymentExecutionId;
    var getResult;
    var checkout;

    if (!orderNo || !returnNonce) {
        return {
            status: 'error',
            redirectUrl: null,
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        };
    }

    order = OrderMgr.getOrder(orderNo);

    if (!order || !isCurrentCustomerOrder(req, order)) {
        return {
            status: 'error',
            redirectUrl: null,
            message: Resource.msg('error.confirmation.error', 'confirmation', null)
        };
    }

    paymentInstrument = payoneCard3DSHelper.getPayonePaymentInstrument(order);
    paymentTransaction = paymentInstrument && paymentInstrument.paymentTransaction;
    commerceCaseId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payoneCommerceCaseId');
    checkoutId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payoneCheckoutId');
    paymentExecutionId = payoneCard3DSHelper.readCustomAttribute(paymentTransaction, 'payonePaymentExecutionId');

    if (!paymentInstrument || !commerceCaseId || !payoneCard3DSHelper.isValidReturnNonce(paymentTransaction, returnNonce)) {
        if (isStoredPostRedirectConfirmationOrder(req, order)) {
            return {
                status: 'success',
                redirectUrl: URLUtils.url('PayoneCommerce-PostRedirectOrderConfirm').toString(),
                message: null
            };
        }

        return {
            status: 'error',
            redirectUrl: null,
            message: Resource.msg('error.payment.not.valid', 'checkout', null)
        };
    }

    getResult = commerceCaseService.get(commerceCaseId, {});

    if (!getResult.ok) {
        return {
            status: 'error',
            redirectUrl: null,
            message: getResult.userMessage || Resource.msg('error.technical', 'checkout', null)
        };
    }

    checkout = payoneCheckoutStateHelper.getCheckout(getResult, checkoutId);

    if (!checkout || !payoneCheckoutStateHelper.getPaymentExecution(checkout, paymentExecutionId)) {
        return {
            status: 'error',
            redirectUrl: null,
            message: Resource.msg('error.payment.not.valid', 'checkout', null)
        };
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

        return {
            status: 'rejected',
            redirectUrl: URLUtils.url('Checkout-Begin', 'stage', 'payment').toString(),
            message: null
        };
    }

    if (payoneCheckoutStateHelper.isSuccessfulPostRedirectState(checkout, paymentExecutionId)) {
        if (order.status.value === Order.ORDER_STATUS_CREATED && !payoneCard3DSHelper.finalizeOrder(order, req)) {
            return {
                status: 'error',
                redirectUrl: null,
                message: Resource.msg('error.technical', 'checkout', null)
            };
        }

        storePostRedirectConfirmationOrder(req, order);
        payoneCard3DSHelper.clearRedirectState(paymentTransaction);
        return {
            status: 'success',
            redirectUrl: URLUtils.url('PayoneCommerce-PostRedirectOrderConfirm').toString(),
            message: null
        };
    }

    if (payoneCheckoutStateHelper.isRedirected(checkout, paymentExecutionId)) {
        return {
            status: 'pending',
            redirectUrl: null,
            message: null
        };
    }

    return {
        status: 'error',
        redirectUrl: null,
        message: Resource.msg('error.payment.not.valid', 'checkout', null)
    };
}

/**
 * Handles the PAYONE return from a post-redirect payment flow.
 *
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @param {Function} next - Next middleware function.
 * @returns {Object} Result of next().
 */
function handlePostRedirectOrderConfirmation(req, res, next) {
    var orderNo = req.querystring.orderNo;
    var returnNonce = req.querystring.nonce;
    var result = resolvePostRedirectOrder(req, orderNo, returnNonce);
    var viewData;

    if (result.redirectUrl) {
        res.redirect(result.redirectUrl);
        return next();
    }

    if (result.status === 'pending') {
        viewData = res.getViewData();
        viewData.postRedirect = {
            orderNo: orderNo,
            nonce: returnNonce,
            statusUrl: URLUtils.url('PayoneCommerce-PostRedirectStatus').toString()
        };
        res.render('payone/postRedirectProcessing', viewData);
        return next();
    }

    res.render('/error', {
        message: result.message
    });
    return next();
}

/**
 * Returns the latest post-redirect payment status for processing-page polling.
 *
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @param {Function} next - Next middleware function.
 * @returns {Object} Result of next().
 */
function handlePostRedirectOrderStatus(req, res, next) {
    var result = resolvePostRedirectOrder(req, req.form.orderNo, req.form.nonce);

    res.json({
        status: result.status,
        redirectUrl: result.redirectUrl
    });
    return next();
}

/**
 * Renders the stable confirmation page for a finalized post-redirect order stored in this session.
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
    handlePostRedirectOrderStatus: handlePostRedirectOrderStatus,
    renderPostRedirectOrderConfirmation: renderPostRedirectOrderConfirmation
};
