'use strict';

var CartItemInput = require('*/cartridge/scripts/models/payone/CartItemInput');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;
var toArray = PayoneCommonUtils.toArray;

/**
 * PAYONE return information model.
 *
 * @param {Object} source - Source object containing return reason and optional items.
 * @constructor
 */
function ReturnInformation(source) {
    var safeSource = source || {};
    var rawItems = toArray(safeSource.items || []);

    this.returnReason = trimString(safeSource.returnReason);
    this.items = rawItems.map(function (item) {
        return new CartItemInput(item);
    });
}

/**
 * Builds PAYONE-compatible return information object.
 *
 * @returns {Object} PAYONE return information payload.
 */
ReturnInformation.prototype.toRequest = function () {
    var payload = {};

    if (this.returnReason) {
        payload.returnReason = this.returnReason;
    }

    if (this.items.length) {
        payload.items = this.items.map(function (item) {
            return item.toRequest();
        });
    }

    return payload;
};

/**
 * Creates return information model from PAYONE response object.
 *
 * @param {Object} payoneResponse - PAYONE response object that may contain `return`.
 * @returns {ReturnInformation} Return information model.
 */
ReturnInformation.fromPayoneResponse = function (payoneResponse) {
    var safeResponse = payoneResponse || {};
    var returnData = safeResponse.return || safeResponse;
    return new ReturnInformation(returnData);
};

/**
 * Creates return information from an SFCC basket.
 *
 * @param {dw.order.Basket|Object} basket - SFCC basket source.
 * @param {string} reason - Return reason to include.
 * @returns {ReturnInformation} Return information model.
 */
ReturnInformation.fromBasket = function (basket, reason) {
    var safeBasket = basket || {};
    var lineItems = typeof safeBasket.getProductLineItems === 'function'
        ? safeBasket.getProductLineItems()
        : safeBasket.productLineItems;

    return new ReturnInformation({
        returnReason: reason,
        items: toArray(lineItems)
    });
};

/**
 * Converts return information to a normalized order update payload.
 *
 * @returns {Object} Normalized return update payload.
 */
ReturnInformation.prototype.toOrderUpdate = function () {
    var payload = {
        returnReason: this.returnReason || null
    };

    if (this.items.length) {
        payload.items = this.items.map(function (item) {
            return item.toOrderUpdate();
        });
    }

    return payload;
};

module.exports = ReturnInformation;
