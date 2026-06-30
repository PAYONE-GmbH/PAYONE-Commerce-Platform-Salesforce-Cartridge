'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var MAX_MERCHANT_REFERENCE_LENGTH = 20; // PAYONE References.merchantReference max length.
var MAX_DESCRIPTOR_LENGTH = 256; // PAYONE References.descriptor max length.
var trimString = PayoneCommonUtils.trimString;
var clip = PayoneCommonUtils.clip;

/**
 * PAYONE order/payment references model.
 *
 * @param {Object} source - Input source object.
 * @constructor
 */
function References(source) {
    var safeSource = source || {};

    this.merchantReference = clip(trimString(safeSource.merchantReference), MAX_MERCHANT_REFERENCE_LENGTH);
    this.descriptor = clip(trimString(safeSource.descriptor), MAX_DESCRIPTOR_LENGTH);
    this.merchantParameters = trimString(safeSource.merchantParameters);
}

/**
 * Builds PAYONE-compatible references payload.
 *
 * @returns {Object} PAYONE references payload.
 */
References.prototype.toRequest = function () {
    var payload = {};

    if (this.merchantReference) {
        payload.merchantReference = this.merchantReference;
    }
    if (this.descriptor) {
        payload.descriptor = this.descriptor;
    }
    if (this.merchantParameters) {
        payload.merchantParameters = this.merchantParameters;
    }

    return payload;
};

module.exports = References;
