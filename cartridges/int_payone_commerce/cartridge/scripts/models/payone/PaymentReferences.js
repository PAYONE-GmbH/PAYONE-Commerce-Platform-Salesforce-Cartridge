'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var MAX_MERCHANT_REFERENCE_LENGTH = 20; // PAYONE Commerce API does not allow References.merchantReference to exceed 20 characters.
var trimString = PayoneCommonUtils.trimString;
var clip = PayoneCommonUtils.clip;

/**
 * Normalizes a payment reference to PAYONE's length constraints.
 *
 * @param {string} input - Merchant reference input.
 * @returns {string|null} Normalized merchant reference.
 */
function normalizeMerchantReference(input) {
    return clip(trimString(input), MAX_MERCHANT_REFERENCE_LENGTH);
}

/**
 * PAYONE payment references model.
 *
 * @param {Object} source - Input source object.
 * @constructor
 */
function PaymentReferences(source) {
    var safeSource = source || {};
    this.merchantReference = normalizeMerchantReference(safeSource.merchantReference);
}

/**
 * Builds PAYONE-compatible payment references object.
 *
 * @returns {Object} PAYONE payment references payload.
 */
PaymentReferences.prototype.toRequest = function () {
    var payload = {};

    if (this.merchantReference) {
        payload.merchantReference = this.merchantReference;
    }

    return payload;
};

/**
 * Creates payment references from PAYONE response output.
 *
 * @param {Object} response - PAYONE response that may contain `references`.
 * @returns {PaymentReferences} Payment references model.
 */
PaymentReferences.fromPayoneResponse = function (response) {
    var safeResponse = response || {};
    var references = safeResponse.references || {};
    return new PaymentReferences({
        merchantReference: references.merchantReference || null
    });
};

/**
 * Converts references to normalized order update payload.
 *
 * @returns {Object} SFCC order custom update payload.
 */
PaymentReferences.prototype.toOrderUpdate = function () {
    return {
        merchantReference: this.merchantReference || null
    };
};

module.exports = PaymentReferences;
