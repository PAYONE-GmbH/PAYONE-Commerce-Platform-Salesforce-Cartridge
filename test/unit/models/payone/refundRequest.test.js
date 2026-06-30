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

function ReturnInformationStub(source) {
    this.source = source || {};
}

ReturnInformationStub.prototype.toRequest = function () {
    return {
        returnReason: this.source.returnReason,
        items: this.source.items || []
    };
};

var RefundRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/RefundRequest', {
    '*/cartridge/scripts/models/payone/PaymentReferences': PaymentReferencesStub,
    '*/cartridge/scripts/models/payone/ReturnInformation': ReturnInformationStub,
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

describe('RefundRequest model', function () {
    it('should build PAYONE refund request payload', function () {
        var model = new RefundRequest({
            amountOfMoney: {
                amount: 3675,
                currencyCode: 'EUR'
            },
            references: {
                merchantReference: 'ref-00000303-123456'
            },
            'return': {
                returnReason: 'CUSTOMER_RETURNED',
                items: [
                    { id: 'line-1' }
                ]
            }
        });

        assert.deepEqual(model.toRequest(), {
            amountOfMoney: {
                amount: 3675,
                currencyCode: 'EUR'
            },
            references: {
                merchantReference: 'ref-00000303-123456'
            },
            'return': {
                returnReason: 'CUSTOMER_RETURNED',
                items: [
                    { id: 'line-1' }
                ]
            }
        });
    });

    it('should omit empty optional refund fields', function () {
        var model = new RefundRequest({
            references: {}
        });

        assert.deepEqual(model.toRequest(), {});
    });

    it('should normalize refund amount payload for PAYONE compatibility', function () {
        var model = new RefundRequest({
            amountOfMoney: {
                amount: '3675',
                currencyCode: 'eur'
            },
            'return': {}
        });

        assert.deepEqual(model.toRequest(), {
            amountOfMoney: {
                amount: 3675,
                currencyCode: 'EUR'
            }
        });
    });

    it('should omit invalid refund amount payload', function () {
        var model = new RefundRequest({
            amountOfMoney: {
                amount: '36.75',
                currencyCode: 'eur'
            }
        });

        assert.deepEqual(model.toRequest(), {});
    });
});
