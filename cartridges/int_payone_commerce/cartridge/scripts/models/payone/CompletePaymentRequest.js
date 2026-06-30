'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var copyIfPresent = PayoneCommonUtils.copyIfPresent;

/**
 * PAYONE complete-payment request model.
 *
 * @param {Object} source - Complete-payment request source object.
 * @constructor
 */
function CompletePaymentRequest(source) {
    var safeSource = source || {};

    this.financingPaymentMethodSpecificInput = safeSource.financingPaymentMethodSpecificInput || null;
    this.redirectPaymentMethodSpecificInput = safeSource.redirectPaymentMethodSpecificInput || null;
    this.order = safeSource.order || null;
    this.device = safeSource.device || null;
}

/**
 * Builds the PAYONE complete-payment request payload.
 *
 * @returns {Object} PAYONE complete-payment request payload.
 */
CompletePaymentRequest.prototype.toRequest = function () {
    var payload = {};

    copyIfPresent(payload, this, 'financingPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'redirectPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'order');
    copyIfPresent(payload, this, 'device');

    return payload;
};

module.exports = CompletePaymentRequest;
