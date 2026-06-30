'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var PayoneCommonUtils = require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils');

var CancelPaymentRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CancelPaymentRequest', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

describe('CancelPaymentRequest model', function () {
    it('should build PAYONE payment-cancel request payload', function () {
        var model = new CancelPaymentRequest({
            cancellationReason: 'FRAUDULENT'
        });

        assert.deepEqual(model.toRequest(), {
            cancellationReason: 'FRAUDULENT'
        });
    });

    it('should omit empty payment-cancel request fields', function () {
        var model = new CancelPaymentRequest({});

        assert.deepEqual(model.toRequest(), {});
    });

    it('should trim cancellation reason for PAYONE compatibility', function () {
        var model = new CancelPaymentRequest({
            cancellationReason: '  CONSUMER_REQUEST  '
        });

        assert.deepEqual(model.toRequest(), {
            cancellationReason: 'CONSUMER_REQUEST'
        });
    });
});
