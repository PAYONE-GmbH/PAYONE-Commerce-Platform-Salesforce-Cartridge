'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var CompleteOrderRequest = proxyquire(
    '../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CompleteOrderRequest',
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

describe('CompleteOrderRequest model', function () {
    it('should build a payload when completePaymentMethodSpecificInput exists', function () {
        var model = new CompleteOrderRequest({
            completePaymentMethodSpecificInput: {
                paymentProduct840SpecificInput: {
                    javaScriptSdkFlow: true,
                    action: 'CONFIRM_ORDER_STATUS'
                }
            }
        });

        assert.deepEqual(model.toRequest(), {
            completePaymentMethodSpecificInput: {
                paymentProduct840SpecificInput: {
                    javaScriptSdkFlow: true,
                    action: 'CONFIRM_ORDER_STATUS'
                }
            }
        });
    });

    it('should return an empty payload when no input is provided', function () {
        var model = new CompleteOrderRequest({});

        assert.deepEqual(model.toRequest(), {});
    });
});
