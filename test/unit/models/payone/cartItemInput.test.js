'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var CartItemInput = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CartItemInput', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils'),
    'dw/system/Site': {
        current: {
            ID: 'RefArch'
        }
    }
});

function toCollection(items) {
    return {
        toArray: function () {
            return items.slice();
        }
    };
}

describe('CartItemInput model', function () {
    it('should build PAYONE request payload from plain item input', function () {
        var model = new CartItemInput({
            invoiceData: {
                description: '  Gilet  '
            },
            orderLineDetails: {
                id: 'line-1',
                productCode: 'SKU-001',
                productType: 'GOODS',
                quantity: 2,
                productPrice: 1500,
                taxAmount: 120,
                taxAmountPerUnit: false,
                productUrl: ' https://example.com/p/1 ',
                merchantShopDeliveryReference: ' RefArch '
            },
            supplierReferences: {
                supplierId: ' supplier-1 ',
                orderReference: ' order-1 ',
                ignoredField: 'should-not-pass'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.invoiceData.description, 'Gilet');
        assert.equal(payload.orderLineDetails.id, undefined);
        assert.equal(payload.orderLineDetails.productCode, 'SKU-001');
        assert.equal(payload.orderLineDetails.quantity, 2);
        assert.equal(payload.orderLineDetails.productPrice, 1500);
        assert.equal(payload.orderLineDetails.taxAmount, 120);
        assert.equal(payload.orderLineDetails.taxAmountPerUnit, false);
        assert.equal(payload.orderLineDetails.productUrl, 'https://example.com/p/1');
        assert.equal(payload.orderLineDetails.merchantShopDeliveryReference, 'RefArch');
        assert.equal(payload.supplierReferences.supplierId, 'supplier-1');
        assert.equal(payload.supplierReferences.orderReference, 'order-1');
        assert.equal(payload.supplierReferences.ignoredField, undefined);
    });

    it('should build request payload from an SFCC product line item', function () {
        var model = new CartItemInput({
            UUID: 'pli-1',
            getProductID: function () {
                return '701644391690M';
            },
            product: {
                ID: '701644391690M',
                name: 'Gilet a bordure tissee'
            },
            productName: 'Gilet a bordure tissee',
            quantityValue: 2,
            adjustedGrossPrice: {
                value: 67.20
            },
            adjustedTax: {
                value: 3.20
            }
        });

        var payload = model.toRequest();
        var updatePayload = model.toOrderUpdate();

        assert.equal(payload.invoiceData.description, 'Gilet a bordure tissee');
        assert.equal(payload.orderLineDetails.id, undefined);
        assert.equal(payload.orderLineDetails.productCode, '701644391690M');
        assert.equal(payload.orderLineDetails.productType, 'GOODS');
        assert.equal(payload.orderLineDetails.quantity, 2);
        assert.equal(payload.orderLineDetails.productPrice, 3360);
        assert.equal(payload.orderLineDetails.taxAmount, 320);
        assert.equal(payload.orderLineDetails.taxAmountPerUnit, false);
        assert.equal(payload.orderLineDetails.merchantShopDeliveryReference, 'RefArch');
        assert.equal(updatePayload.orderLineDetails.id, 'pli-1');
    });

    it('should include option line item amounts when calculating SFCC totals', function () {
        var model = new CartItemInput({
            UUID: 'pli-options',
            getProductID: function () {
                return 'SKU-CAMERA';
            },
            product: {
                ID: 'SKU-CAMERA',
                name: 'Camera'
            },
            quantityValue: 1,
            adjustedGrossPrice: {
                value: 367.49
            },
            adjustedTax: {
                value: 17.50
            },
            optionProductLineItems: toCollection([
                {
                    adjustedGrossPrice: {
                        value: 41.99
                    },
                    adjustedTax: {
                        value: 2.00
                    }
                }
            ])
        });

        var payload = model.toRequest();

        assert.equal(payload.orderLineDetails.productPrice, 40948);
        assert.equal(payload.orderLineDetails.taxAmount, 1950);
        assert.equal(payload.orderLineDetails.taxAmountPerUnit, false);
    });

    it('should fall back to tax when adjustedTax is not available', function () {
        var model = new CartItemInput({
            UUID: 'pli-tax',
            getProductID: function () {
                return 'SKU-TAX';
            },
            product: {
                ID: 'SKU-TAX',
                name: 'Taxed Item'
            },
            quantityValue: 1,
            adjustedGrossPrice: {
                value: 20.00
            },
            tax: 1.25
        });

        var payload = model.toRequest();

        assert.equal(payload.orderLineDetails.productPrice, 2000);
        assert.equal(payload.orderLineDetails.taxAmount, 125);
        assert.equal(payload.orderLineDetails.taxAmountPerUnit, false);
    });

    it('should normalize invalid numeric input to safe defaults', function () {
        var model = new CartItemInput({
            orderLineDetails: {
                productCode: 'SKU-001',
                quantity: 'bad-value',
                productPrice: 'bad-value'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.orderLineDetails.quantity, 1);
        assert.equal(payload.orderLineDetails.productPrice, 0);
        assert.equal(payload.orderLineDetails.productType, 'GOODS');
    });

    it('should omit tax fields for zero-price items', function () {
        var model = new CartItemInput({
            orderLineDetails: {
                productCode: 'FREE-GIFT',
                productType: 'GOODS',
                quantity: 1,
                productPrice: 0,
                taxAmount: 0,
                taxAmountPerUnit: false
            },
            invoiceData: {
                description: 'Free Gift'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.orderLineDetails.productCode, 'FREE-GIFT');
        assert.equal(payload.orderLineDetails.productPrice, 0);
        assert.equal(payload.orderLineDetails.taxAmount, undefined);
        assert.equal(payload.orderLineDetails.taxAmountPerUnit, undefined);
    });
});
