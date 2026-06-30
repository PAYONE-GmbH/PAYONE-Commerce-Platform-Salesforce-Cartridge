'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var CheckoutReferences = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CheckoutReferences', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils')
});

describe('CheckoutReferences model', function () {
    it('should trim and clip checkout reference values', function () {
        var model = new CheckoutReferences({
            merchantReference: '  ck-1234567890123456789012345678901234567890-extra  ',
            merchantShopReference: '  shop-1234567890123456789012345678901234567890123456789012345678901234-extra  '
        });
        var payload = model.toRequest();

        assert.equal(payload.merchantReference.length, 40);
        assert.equal(payload.merchantShopReference.length, 64);
    });
});
