'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var PayoneCommonUtils = require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils');

var CancelCheckoutRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CancelCheckoutRequest', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

describe('CancelCheckoutRequest model', function () {
    it('should build PAYONE checkout-cancel request payload', function () {
        var model = new CancelCheckoutRequest({
            cancelType: 'FULL',
            cancellationReason: 'CONSUMER_REQUEST'
        });

        assert.deepEqual(model.toRequest(), {
            cancelType: 'FULL',
            cancellationReason: 'CONSUMER_REQUEST'
        });
    });

    it('should normalize valid cancel items', function () {
        var model = new CancelCheckoutRequest({
            cancelItems: [
                null,
                {},
                { id: ' item-1 ', quantity: '2' },
                { id: 'item-2', quantity: 0 }
            ]
        });

        assert.deepEqual(model.toRequest(), {
            cancelItems: [
                {
                    id: 'item-1',
                    quantity: 2
                }
            ]
        });
    });

    it('should omit empty checkout-cancel request fields', function () {
        var model = new CancelCheckoutRequest({});

        assert.deepEqual(model.toRequest(), {});
    });
});
