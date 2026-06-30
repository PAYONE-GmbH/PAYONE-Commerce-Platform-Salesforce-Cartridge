'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var PaymentReferences = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/PaymentReferences', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils')
});

describe('PaymentReferences model', function () {
    it('should trim and clip merchant reference values', function () {
        var model = new PaymentReferences({
            merchantReference: '  ord-12345678901234567890-extra  '
        });

        assert.deepEqual(model.toRequest(), {
            merchantReference: 'ord-1234567890123456'
        });
    });

    it('should unwrap PAYONE response references and expose order update payload', function () {
        var model = PaymentReferences.fromPayoneResponse({
            references: {
                merchantReference: 'ord-999'
            }
        });

        assert.deepEqual(model.toOrderUpdate(), {
            merchantReference: 'ord-999'
        });
    });
});
