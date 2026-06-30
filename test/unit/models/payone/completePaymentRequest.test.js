'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var CompletePaymentRequest = proxyquire(
    '../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CompletePaymentRequest',
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

describe('CompletePaymentRequest model', function () {
    it('should build a payload when financing input, order, and device exist', function () {
        var model = new CompletePaymentRequest({
            financingPaymentMethodSpecificInput: {
                paymentProductId: 3391,
                requiresApproval: true,
                paymentProduct3391SpecificInput: {
                    installmentOptionId: 'installment-option-1'
                }
            },
            order: {
                references: {
                    merchantReference: 'order-ref-1'
                }
            },
            device: {
                ipAddress: '127.0.0.1'
            }
        });

        assert.deepEqual(model.toRequest(), {
            financingPaymentMethodSpecificInput: {
                paymentProductId: 3391,
                requiresApproval: true,
                paymentProduct3391SpecificInput: {
                    installmentOptionId: 'installment-option-1'
                }
            },
            order: {
                references: {
                    merchantReference: 'order-ref-1'
                }
            },
            device: {
                ipAddress: '127.0.0.1'
            }
        });
    });

    it('should return an empty payload when no input is provided', function () {
        var model = new CompletePaymentRequest({});

        assert.deepEqual(model.toRequest(), {});
    });
});
