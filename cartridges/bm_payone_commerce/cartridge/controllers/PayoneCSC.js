'use strict';

var ISML = require('dw/template/ISML');
var csrfProtection = require('dw/web/CSRFProtection');
var payoneCSCHelper = require('*/cartridge/scripts/payone/payoneCSCHelper');

/**
 * PAYONE CSC endpoint.
 *
 * Renders the CSC page on `GET` and executes PAYONE post-order actions on `POST`.
 *
 * @returns {void} Rendered CSC response.
 */
exports.CustomerServiceCenter = function () {
    var orderNo = request.httpParameterMap.orderNo.stringValue || '';
    var action = null;
    var actionResult = null;
    var actionScope = request.httpParameterMap.actionScope.stringValue || 'item';
    var cancellationReason = request.httpParameterMap.cancellationReason.stringValue || '';
    var isPost = request.httpMethod === 'POST';
    var renderData;

    if (isPost && !csrfProtection.validateRequest()) {
        return ISML.renderTemplate('csrfFail');
    }

    if (isPost) {
        if (request.httpParameterMap.capture.stringValue) {
            action = 'capture';
        } else if (request.httpParameterMap.refund.stringValue) {
            action = 'refund';
        } else if (request.httpParameterMap.cancel.stringValue) {
            action = 'cancel';
        }
    }

    if (action) {
        actionResult = payoneCSCHelper.executeAction(
            orderNo,
            action,
            request.httpParameterMap.selectedItems.stringValue,
            actionScope,
            request.httpParameterMap.orderAmount.stringValue,
            cancellationReason
        );
    }

    renderData = payoneCSCHelper.buildViewData(orderNo, actionResult, actionScope, cancellationReason);
    renderData.csrf = {
        tokenName: csrfProtection.getTokenName(),
        token: csrfProtection.generateToken()
    };

    return ISML.renderTemplate('payone/csc/order', renderData);
};

exports.CustomerServiceCenter.public = true;
