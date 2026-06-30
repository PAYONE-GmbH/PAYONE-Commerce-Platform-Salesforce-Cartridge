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
            id: this.source.id || this.source.UUID || this.source.orderLineDetails.id,
            productCode: this.source.productCode || this.source.orderLineDetails.productCode,
            quantity: this.source.quantity || this.source.orderLineDetails.quantity,
            productPrice: this.source.productPrice || this.source.orderLineDetails.productPrice,
            productType: this.source.productType || this.source.orderLineDetails.productType
        }
    };
};

var DeliveryInformation = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/DeliveryInformation', {
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

describe('DeliveryInformation model', function () {
    it('should wrap items and expose PAYONE request payload', function () {
        var model = new DeliveryInformation({
            items: [
                { id: 'line-1' },
                { id: 'line-2' }
            ]
        });

        var payload = model.toRequest();

        assert.deepEqual(payload.items, [
            { requestId: 'line-1' },
            { requestId: 'line-2' }
        ]);
    });

    it('should build order update items from wrapped cart items', function () {
        var model = new DeliveryInformation({
            items: [
                {
                    orderLineDetails: {
                        id: 'line-1',
                        productCode: 'SKU-1',
                        quantity: 1,
                        productPrice: 1000,
                        productType: 'GOODS'
                    }
                }
            ]
        });

        assert.deepEqual(model.toOrderUpdate(), [
            {
                id: 'line-1',
                productCode: 'SKU-1',
                quantity: 1,
                productPrice: 1000,
                productType: 'GOODS'
            }
        ]);
    });

    it('should build from basket and PAYONE response sources', function () {
        var fromBasket = DeliveryInformation.fromBasket({
            getProductLineItems: function () {
                return toCollection([
                    { id: 'basket-item' }
                ]);
            }
        });
        var fromResponse = DeliveryInformation.fromPayoneResponse({
            checkout: {
                shoppingCart: {
                    items: [
                        { id: 'response-item' }
                    ]
                }
            }
        });

        assert.equal(fromBasket.toRequest().items[0].requestId, 'basket-item');
        assert.equal(fromResponse.toRequest().items[0].requestId, 'response-item');
    });
});
