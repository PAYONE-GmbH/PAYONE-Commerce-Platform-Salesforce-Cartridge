'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var PayoneCommonUtils = require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils');

function PaymentReferencesStub(source) {
    this.source = source || {};
}

PaymentReferencesStub.prototype.toRequest = function () {
    return this.source.merchantReference ? {
        merchantReference: this.source.merchantReference
    } : {};
};

function DeliveryInformationStub(source) {
    this.source = source || {};
}

DeliveryInformationStub.prototype.toRequest = function () {
    return {
        items: this.source.items || []
    };
};

var CaptureRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CaptureRequest', {
    '*/cartridge/scripts/models/payone/PaymentReferences': PaymentReferencesStub,
    '*/cartridge/scripts/models/payone/DeliveryInformation': DeliveryInformationStub,
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

describe('CaptureRequest model', function () {
    it('should build PAYONE capture request payload', function () {
        var model = new CaptureRequest({
            amount: '3675',
            isFinal: false,
            cancellationReason: 'CUSTOMER_CANCELLED',
            references: {
                merchantReference: 'cap-00000303-123456'
            },
            delivery: {
                items: [
                    { id: 'line-1' }
                ]
            }
        });

        assert.deepEqual(model.toRequest(), {
            amount: 3675,
            isFinal: false,
            cancellationReason: 'CUSTOMER_CANCELLED',
            references: {
                merchantReference: 'cap-00000303-123456'
            },
            delivery: {
                items: [
                    { id: 'line-1' }
                ]
            }
        });
    });

    it('should omit empty optional capture fields', function () {
        var model = new CaptureRequest({
            amount: 0,
            references: {},
            delivery: null
        });

        assert.deepEqual(model.toRequest(), {});
    });

    it('should keep capture payload YAML-compatible by omitting invalid amount and empty delivery', function () {
        var model = new CaptureRequest({
            amount: '36.75',
            isFinal: true,
            cancellationReason: '  CUSTOMER_CANCELLED  ',
            delivery: {
                items: []
            }
        });

        assert.deepEqual(model.toRequest(), {
            isFinal: true,
            cancellationReason: 'CUSTOMER_CANCELLED'
        });
    });
});
