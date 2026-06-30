'use strict';

var References = require('*/cartridge/scripts/models/payone/References');
var PaymentMethodSpecificInput = require('*/cartridge/scripts/models/payone/PaymentMethodSpecificInput');

/**
 * Builds normalized partial-order items from raw input.
 *
 * @param {Array<Object>} source - Raw order item input.
 * @returns {Array<Object>} Normalized partial-order items.
 */
function buildItems(source) {
    var safeSource = source || [];
    var items = [];
    var i;

    for (i = 0; i < safeSource.length; i += 1) {
        if (safeSource[i] && (safeSource[i].id || typeof safeSource[i].quantity !== 'undefined')) {
            items.push({
                id: safeSource[i].id || null,
                quantity: typeof safeSource[i].quantity === 'undefined' ? null : safeSource[i].quantity
            });
        }
    }

    return items;
}

/**
 * PAYONE order request model.
 *
 * @param {Object} source - Order request source object.
 * @constructor
 */
function OrderRequest(source) {
    var safeSource = source || {};
    this.orderType = safeSource.orderType || null;
    this.orderReferences = new References(safeSource.orderReferences || {});
    this.paymentMethodSpecificInput = new PaymentMethodSpecificInput(safeSource.paymentMethodSpecificInput || {});
    this.items = buildItems(safeSource.items || []);
}

/**
 * Builds the PAYONE order request payload.
 *
 * @returns {Object} PAYONE order request payload.
 */
OrderRequest.prototype.toRequest = function () {
    var payload = {};
    var orderReferences = this.orderReferences.toRequest();
    var paymentMethodSpecificInput = this.paymentMethodSpecificInput.toRequest();
    var orderType;

    if (Object.keys(orderReferences).length) {
        payload.orderReferences = orderReferences;
    }

    if (Object.keys(paymentMethodSpecificInput).length) {
        payload.paymentMethodSpecificInput = paymentMethodSpecificInput;
    }

    orderType = this.orderType || ((payload.orderReferences || payload.paymentMethodSpecificInput) ? 'FULL' : null);

    if (orderType === 'PARTIAL' && this.items.length) {
        payload.items = this.items;
    }

    if (orderType && (payload.orderReferences || payload.paymentMethodSpecificInput || payload.items)) {
        payload.orderType = orderType;
    }

    return payload;
};

module.exports = OrderRequest;
