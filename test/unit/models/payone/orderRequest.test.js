'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var PayoneCommonUtils = require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils');
var PaymentMethodSpecificInput = proxyquire(
    '../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/PaymentMethodSpecificInput',
    {
        '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
    }
);

var References = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/References', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

var OrderRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/OrderRequest', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils,
    '*/cartridge/scripts/models/payone/References': References,
    '*/cartridge/scripts/models/payone/PaymentMethodSpecificInput': PaymentMethodSpecificInput
});

describe('OrderRequest model', function () {
    it('should build a full order request and omit items when order data is present', function () {
        var model = new OrderRequest({
            orderReferences: {
                merchantReference: 'ord-123',
                descriptor: 'Descriptor',
                merchantParameters: '{"session":"123"}'
            },
            paymentMethodSpecificInput: {
                customerDevice: {
                    ipAddress: '127.0.0.1'
                }
            },
            items: [
                {
                    id: 'line-1',
                    quantity: 1
                },
                {
                    quantity: 2
                }
            ]
        });

        var payload = model.toRequest();

        assert.equal(payload.orderType, 'FULL');
        assert.equal(payload.orderReferences.merchantReference, 'ord-123');
        assert.equal(payload.orderReferences.descriptor, 'Descriptor');
        assert.equal(payload.orderReferences.merchantParameters, '{"session":"123"}');
        assert.equal(payload.paymentMethodSpecificInput.paymentChannel, 'ECOMMERCE');
        assert.equal(payload.items, undefined);
    });

    it('should drop invalid items from a partial order request payload', function () {
        var model = new OrderRequest({
            orderType: 'PARTIAL',
            items: [
                null,
                {},
                {
                    id: 'line-1'
                }
            ]
        });

        assert.deepEqual(model.toRequest().items, [
            {
                id: 'line-1',
                quantity: null
            }
        ]);
    });

    it('should return an empty request when no order content exists', function () {
        var model = new OrderRequest({});

        assert.deepEqual(model.toRequest(), {});
    });

    it('should preserve explicit partial order type', function () {
        var model = new OrderRequest({
            orderType: 'PARTIAL',
            items: [
                {
                    id: 'line-1',
                    quantity: 1
                }
            ]
        });

        assert.equal(model.toRequest().orderType, 'PARTIAL');
    });

    it('should not build a payload from items alone without partial order type', function () {
        var model = new OrderRequest({
            items: [
                {
                    id: 'line-1',
                    quantity: 1
                }
            ]
        });

        assert.deepEqual(model.toRequest(), {});
    });
});
