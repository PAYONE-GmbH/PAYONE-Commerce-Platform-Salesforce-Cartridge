'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;

/**
 * PAYONE payment-cancel request model.
 *
 * @param {Object} source - Source cancel data.
 * @constructor
 */
function CancelPaymentRequest(source) {
    var safeSource = source || {};

    this.cancellationReason = trimString(safeSource.cancellationReason);
}

/**
 * Builds the PAYONE payment-cancel request payload.
 *
 * @returns {Object} PAYONE payment-cancel request payload.
 */
CancelPaymentRequest.prototype.toRequest = function () {
    var payload = {};

    if (this.cancellationReason) {
        payload.cancellationReason = this.cancellationReason;
    }

    return payload;
};

module.exports = CancelPaymentRequest;
