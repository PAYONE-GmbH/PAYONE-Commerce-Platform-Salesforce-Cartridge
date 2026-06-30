'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var PaymentMethodSpecificInput = proxyquire(
    '../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/PaymentMethodSpecificInput',
    {
        '*/cartridge/scripts/payone/PayoneCommonUtils': {
            copyIfPresent: function (target, source, key) {
                if (typeof source[key] !== 'undefined' && source[key] !== null) {
                    target[key] = source[key];
                }

                return target;
            }
        }
    }
);

describe('PaymentMethodSpecificInput model', function () {
    it('should set ECOMMERCE payment channel when any specific input exists', function () {
        var model = new PaymentMethodSpecificInput({
            financingPaymentMethodSpecificInput: {
                paymentProductId: 3390
            }
        });

        assert.deepEqual(model.toRequest(), {
            financingPaymentMethodSpecificInput: {
                paymentProductId: 3390
            },
            paymentChannel: 'ECOMMERCE'
        });
    });

    it('should return an empty payload when no inputs are provided', function () {
        var model = new PaymentMethodSpecificInput({});

        assert.deepEqual(model.toRequest(), {});
    });
});
