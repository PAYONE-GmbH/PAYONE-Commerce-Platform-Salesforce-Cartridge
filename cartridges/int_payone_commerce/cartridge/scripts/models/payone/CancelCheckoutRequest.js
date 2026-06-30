'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;
var toInt = PayoneCommonUtils.toInt;

/**
 * Builds normalized cancel-item entries from raw input.
 *
 * @param {Array<Object>} source - Raw cancel-item input.
 * @returns {Array<Object>} Normalized cancel items.
 */
function buildCancelItems(source) {
    var safeSource = source || [];
    var cancelItems = [];
    var i;
    var id;
    var quantity;

    for (i = 0; i < safeSource.length; i += 1) {
        id = trimString(safeSource[i] && safeSource[i].id);
        quantity = toInt(safeSource[i] && safeSource[i].quantity);

        if (id && quantity && quantity > 0) {
            cancelItems.push({
                id: id,
                quantity: quantity
            });
        }
    }

    return cancelItems;
}

/**
 * PAYONE checkout-cancel request model.
 *
 * @param {Object} source - Source cancel data.
 * @constructor
 */
function CancelCheckoutRequest(source) {
    var safeSource = source || {};

    this.cancelType = trimString(safeSource.cancelType);
    this.cancellationReason = trimString(safeSource.cancellationReason);
    this.cancelItems = buildCancelItems(safeSource.cancelItems);
}

/**
 * Builds the PAYONE checkout-cancel request payload.
 *
 * @returns {Object} PAYONE checkout-cancel request payload.
 */
CancelCheckoutRequest.prototype.toRequest = function () {
    var payload = {};

    if (this.cancelType) {
        payload.cancelType = this.cancelType;
    }

    if (this.cancellationReason) {
        payload.cancellationReason = this.cancellationReason;
    }

    if (this.cancelItems.length) {
        payload.cancelItems = this.cancelItems;
    }

    return payload;
};

module.exports = CancelCheckoutRequest;
