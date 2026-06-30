'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var MAX_CHECKOUT_REFERENCE_LENGTH = 40; // PAYONE CheckoutReferences.merchantReference max length.
var MAX_MERCHANT_SHOP_REFERENCE_LENGTH = 64; // PAYONE CheckoutReferences.merchantShopReference max length.
var trimString = PayoneCommonUtils.trimString;
var clip = PayoneCommonUtils.clip;

/**
 * PAYONE checkout references model.
 *
 * @param {Object} source - Input source object.
 * @constructor
 */
function CheckoutReferences(source) {
    var safeSource = source || {};

    this.merchantReference = clip(trimString(safeSource.merchantReference), MAX_CHECKOUT_REFERENCE_LENGTH);
    this.merchantShopReference = clip(trimString(safeSource.merchantShopReference), MAX_MERCHANT_SHOP_REFERENCE_LENGTH);
}

/**
 * Builds PAYONE-compatible checkout references payload.
 *
 * @returns {Object} PAYONE checkout references payload.
 */
CheckoutReferences.prototype.toRequest = function () {
    var payload = {};

    if (this.merchantReference) {
        payload.merchantReference = this.merchantReference;
    }
    if (this.merchantShopReference) {
        payload.merchantShopReference = this.merchantShopReference;
    }

    return payload;
};

module.exports = CheckoutReferences;
