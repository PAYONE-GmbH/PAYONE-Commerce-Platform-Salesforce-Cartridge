'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

function CartItemInputStub(source) {
    this.source = source;
}

CartItemInputStub.prototype.toRequest = function () {
    return {
        requestId: this.source.id || this.source.UUID || this.source.orderLineDetails.id
    };
};

CartItemInputStub.prototype.toOrderUpdate = function () {
    return {
        orderLineDetails: {
            id: this.source.id || this.source.UUID || this.source.orderLineDetails.id
        }
    };
};

var ReturnInformation = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/ReturnInformation', {
    '*/cartridge/scripts/models/payone/CartItemInput': CartItemInputStub,
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils')
});

function toCollection(items) {
    return {
        toArray: function () {
            return items.slice();
        }
    };
}

describe('ReturnInformation model', function () {
    it('should build PAYONE return request payload', function () {
        var model = new ReturnInformation({
            returnReason: '  CUSTOMER_RETURNED  ',
            items: [
                { id: 'line-1' }
            ]
        });

        assert.deepEqual(model.toRequest(), {
            returnReason: 'CUSTOMER_RETURNED',
            items: [
                { requestId: 'line-1' }
            ]
        });
    });

    it('should build order update payload from wrapped items', function () {
        var model = new ReturnInformation({
            returnReason: 'DAMAGED',
            items: [
                {
                    orderLineDetails: {
                        id: 'line-2'
                    }
                }
            ]
        });

        assert.deepEqual(model.toOrderUpdate(), {
            returnReason: 'DAMAGED',
            items: [
                {
                    orderLineDetails: {
                        id: 'line-2'
                    }
                }
            ]
        });
    });

    it('should build from basket and PAYONE response sources', function () {
        var fromBasket = ReturnInformation.fromBasket({
            getProductLineItems: function () {
                return toCollection([
                    { id: 'basket-item' }
                ]);
            }
        }, 'DAMAGED');
        var fromResponse = ReturnInformation.fromPayoneResponse({
            return: {
                returnReason: 'TOO_SMALL',
                items: [
                    { id: 'response-item' }
                ]
            }
        });

        assert.equal(fromBasket.toRequest().returnReason, 'DAMAGED');
        assert.equal(fromBasket.toRequest().items[0].requestId, 'basket-item');
        assert.equal(fromResponse.toRequest().returnReason, 'TOO_SMALL');
        assert.equal(fromResponse.toRequest().items[0].requestId, 'response-item');
    });
});
