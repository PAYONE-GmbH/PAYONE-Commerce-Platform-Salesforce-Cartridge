'use strict';

var CartItemInput = require('*/cartridge/scripts/models/payone/CartItemInput');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var toArray = PayoneCommonUtils.toArray;

/**
 * PAYONE delivery information model.
 *
 * @param {Object} source - Source object containing delivery cart items.
 * @constructor
 */
function DeliveryInformation(source) {
    var safeSource = source || {};
    var rawItems = typeof safeSource.items !== 'undefined'
        ? toArray(safeSource.items)
        : toArray(safeSource.productLineItems);
    var mapped = [];
    var i;
    var item;

    for (i = 0; i < rawItems.length; i += 1) {
        item = rawItems[i];
        mapped.push(new CartItemInput(item));
    }

    this.items = mapped;
}

/**
 * Builds the PAYONE delivery payload.
 *
 * @returns {{items:Array<Object>}} PAYONE delivery request payload.
 */
DeliveryInformation.prototype.toRequest = function () {
    return {
        items: this.items.map(function (item) {
            return item.toRequest();
        })
    };
};

/**
 * Converts delivery items into a normalized order update structure.
 *
 * @returns {Array<Object>} Normalized delivery item updates.
 */
DeliveryInformation.prototype.toOrderUpdate = function () {
    var updates = [];
    var i;

    for (i = 0; i < this.items.length; i += 1) {
        var details = this.items[i].toOrderUpdate().orderLineDetails || {};
        updates.push({
            id: details.id || null,
            productCode: details.productCode || null,
            quantity: details.quantity,
            productPrice: details.productPrice,
            productType: details.productType || null
        });
    }

    return updates;
};

/**
 * Creates delivery information from an SFCC basket.
 *
 * @param {dw.order.Basket|Object} basket - SFCC basket source.
 * @returns {DeliveryInformation} Delivery information model.
 */
DeliveryInformation.fromBasket = function (basket) {
    var safeBasket = basket || {};
    var lineItems = typeof safeBasket.getProductLineItems === 'function'
        ? safeBasket.getProductLineItems()
        : safeBasket.productLineItems;

    return new DeliveryInformation({ items: lineItems || [] });
};

/**
 * Creates delivery information from a PAYONE response payload.
 *
 * @param {Object} payoneResponse - PAYONE response object containing checkout data.
 * @returns {DeliveryInformation} Delivery information model.
 */
DeliveryInformation.fromPayoneResponse = function (payoneResponse) {
    var safeResponse = payoneResponse || {};
    var firstCheckout = safeResponse.checkouts && safeResponse.checkouts[0];
    var checkout = safeResponse.checkout || firstCheckout || safeResponse;
    var shoppingCart = checkout.shoppingCart || {};
    return new DeliveryInformation({ items: shoppingCart.items });
};

module.exports = DeliveryInformation;
