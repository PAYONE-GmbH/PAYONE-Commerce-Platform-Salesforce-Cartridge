'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var copyIfPresent = PayoneCommonUtils.copyIfPresent;

/**
 * PAYONE complete-order request model.
 *
 * @param {Object} source - Complete-order request source object.
 * @constructor
 */
function CompleteOrderRequest(source) {
    var safeSource = source || {};

    this.completePaymentMethodSpecificInput = safeSource.completePaymentMethodSpecificInput || null;
}

/**
 * Builds the PAYONE complete-order request payload.
 *
 * @returns {Object} PAYONE complete-order request payload.
 */
CompleteOrderRequest.prototype.toRequest = function () {
    var payload = {};

    copyIfPresent(payload, this, 'completePaymentMethodSpecificInput');

    return payload;
};

module.exports = CompleteOrderRequest;
