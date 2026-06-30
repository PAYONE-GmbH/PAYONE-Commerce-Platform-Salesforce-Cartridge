'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');

var base = module.superModule;
var payoneReservedOrderNoHelper = require('*/cartridge/scripts/payone/payoneReservedOrderNoHelper');

/**
 * Attempts to create an order from the current basket, using the PAYONE reserved
 * order number for active pre-authorization flows.
 *
 * @param {dw.order.Basket} currentBasket - The current basket.
 * @returns {dw.order.Order|null} The order object created from the current basket.
 */
base.createOrder = function (currentBasket) {
    var reservedOrderNo = payoneReservedOrderNoHelper.getReservedOrderNo();
    var order;

    try {
        order = Transaction.wrap(function () {
            return reservedOrderNo
                ? OrderMgr.createOrder(currentBasket, reservedOrderNo)
                : OrderMgr.createOrder(currentBasket);
        });
    } catch (error) {
        return null;
    }

    if (order && reservedOrderNo) {
        payoneReservedOrderNoHelper.clearReservedOrderNo();
    }

    return order;
};

module.exports = base;
