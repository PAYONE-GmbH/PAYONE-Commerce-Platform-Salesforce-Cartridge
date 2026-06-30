'use strict';

var server = require('server');
var payoneCommerceMiddleware = require('*/cartridge/scripts/middleware/payoneCommerce');

server.extend(module.superModule);
server.append('Begin', payoneCommerceMiddleware.initializeForms, payoneCommerceMiddleware.checkoutReturnErrors);

module.exports = server.exports();
