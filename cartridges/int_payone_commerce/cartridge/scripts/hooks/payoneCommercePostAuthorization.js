'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var readCustomAttribute = PayoneCommonUtils.readCustomAttribute;

/**
 * Returns the PAYONE payment instrument that still contains an external redirect URL.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @returns {dw.order.PaymentInstrument|Object|null} Matching payment instrument or null.
 */
function getRedirectPaymentInstrument(order) {
    var paymentInstruments = order && order.paymentInstruments ? order.paymentInstruments : [];
    var i;

    for (i = 0; i < paymentInstruments.length; i += 1) {
        if (readCustomAttribute(paymentInstruments[i] && paymentInstruments[i].paymentTransaction, 'payoneRedirectUrl')) {
            return paymentInstruments[i];
        }
    }

    return null;
}

/**
 * Provides an SFRA post-authorization redirect payload when PAYONE requires an external redirect step.
 *
 * @param {Object} result - Authorization result.
 * @param {dw.order.Order|Object} order - Order source.
 * @returns {{error:boolean, redirectUrl:string}|undefined} Redirect payload or undefined.
 */
function postAuthorization(result, order) {
    var paymentInstrument;
    var redirectUrl;

    if (result && result.error) {
        return undefined;
    }

    paymentInstrument = getRedirectPaymentInstrument(order);
    redirectUrl = paymentInstrument ? readCustomAttribute(paymentInstrument.paymentTransaction, 'payoneRedirectUrl') : null;

    if (!redirectUrl) {
        return undefined;
    }

    return {
        error: false,
        redirectUrl: redirectUrl
    };
}

exports.postAuthorization = postAuthorization;
