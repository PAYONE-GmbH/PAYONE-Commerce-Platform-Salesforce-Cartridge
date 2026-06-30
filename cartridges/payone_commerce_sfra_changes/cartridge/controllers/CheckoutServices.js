'use strict';

var server = require('server');
var payoneCommerceMiddleware = require('*/cartridge/scripts/middleware/payoneCommerce');
var payoneCheckoutRefreshHelper = require('*/cartridge/scripts/payone/payoneCheckoutRefreshHelper');

server.extend(module.superModule);

server.append('SubmitPayment', payoneCheckoutRefreshHelper.applySubmitPaymentRefresh);
server.prepend('PlaceOrder', payoneCommerceMiddleware.cleanupInvalidPaymentContexts);
server.append('PlaceOrder', payoneCheckoutRefreshHelper.applyPlaceOrderRefresh);

module.exports = server.exports();
