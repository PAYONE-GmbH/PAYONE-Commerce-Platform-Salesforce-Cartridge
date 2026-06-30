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
var loggerStub = {
    warn: function () {}
};

var References = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/References', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});
var CheckoutReferences = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CheckoutReferences', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils
});

var CartItemInput = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CartItemInput', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils,
    'dw/system/Site': {
        current: {
            ID: 'RefArch'
        }
    }
});
var OrderRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/OrderRequest', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils,
    '*/cartridge/scripts/models/payone/References': References,
    '*/cartridge/scripts/models/payone/PaymentMethodSpecificInput': PaymentMethodSpecificInput
});
var CreateCheckoutRequest = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/CreateCheckoutRequest', {
    '*/cartridge/scripts/models/payone/CartItemInput': CartItemInput,
    '*/cartridge/scripts/models/payone/CheckoutReferences': CheckoutReferences,
    '*/cartridge/scripts/models/payone/OrderRequest': OrderRequest,
    '*/cartridge/scripts/payone/PayoneCommonUtils': PayoneCommonUtils,
    '*/cartridge/scripts/payone/payoneMerchantReferenceHelper': {
        buildCheckoutReference: function (orderNo) {
            return orderNo ? '222' + orderNo : null;
        },
        buildPaymentReference: function (orderNo) {
            return orderNo ? '333' + orderNo : null;
        }
    },
    'dw/system/Logger': {
        getLogger: function () {
            return loggerStub;
        }
    },
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

describe('CreateCheckoutRequest model', function () {
    it('should build request payload from plain source input', function () {
        var model = new CreateCheckoutRequest({
            amountOfMoney: {
                amount: 7349,
                currencyCode: 'eur'
            },
            references: {
                merchantReference: 'ck-123',
                merchantShopReference: 'shop-1'
            },
            shipping: {
                address: {
                    street: 'Test Street',
                    city: 'Paris',
                    zip: '75003',
                    countryCode: 'fr',
                    additionalInfo: 'Happy Friday Center',
                    state: 'IDF',
                    name: {
                        firstName: 'John',
                        surname: 'Doe'
                    }
                }
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: '701644391690M',
                            productType: 'GOODS',
                            quantity: 1,
                            productPrice: 6720
                        }
                    }
                ]
            },
            orderRequest: {
                orderReferences: {
                    merchantReference: 'ord-123'
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.autoExecuteOrder, true);
        assert.equal(payload.amountOfMoney.amount, 7349);
        assert.equal(payload.amountOfMoney.currencyCode, 'EUR');
        assert.equal(payload.references.merchantReference, 'ck-123');
        assert.equal(payload.references.merchantShopReference, 'shop-1');
        assert.equal(payload.shipping.address.countryCode, 'FR');
        assert.equal(payload.shipping.address.additionalInfo, 'Happy Friday Center');
        assert.equal(payload.shipping.address.name.firstName, 'John');
        assert.equal(payload.orderRequest.orderReferences.merchantReference, 'ord-123');
    });

    it('should allow autoExecuteOrder to be disabled for checkout-only flows', function () {
        var model = new CreateCheckoutRequest({
            autoExecuteOrder: false,
            amountOfMoney: {
                amount: 7349,
                currencyCode: 'EUR'
            },
            orderRequest: {
                orderReferences: {
                    merchantReference: 'ord-123'
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.autoExecuteOrder, false);
        assert.isUndefined(payload.orderRequest.paymentMethodSpecificInput);
        assert.equal(payload.orderRequest.orderType, 'FULL');
    });

    it('should allow autoExecuteOrder to be disabled through the basket factory boolean', function () {
        var model = CreateCheckoutRequest.fromBasket({
            UUID: 'basket-checkout-only',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 67.20,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return null;
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-1',
                        getProductID: function () {
                            return '701644391690M';
                        },
                        product: {
                            ID: '701644391690M',
                            name: 'Gilet a bordure tissee'
                        },
                        productName: 'Gilet a bordure tissee',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 0
                };
            }
        }, {
            orderReferences: {
                merchantReference: 'ord-basket-checkout-only'
            }
        }, false);

        assert.equal(model.toRequest().autoExecuteOrder, false);
    });

    it('should build basket payload without basket-derived references and with shipment line', function () {
        var model = CreateCheckoutRequest.fromBasket({
            UUID: 'basket-1',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 73.49,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return {
                            address1: 'Test Street',
                            city: 'Paris',
                            postalCode: '75003',
                            countryCode: {
                                value: 'FR'
                            },
                            address2: 'Happy Friday Center',
                            firstName: 'John',
                            lastName: 'Doe'
                        };
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-1',
                        getProductID: function () {
                            return '701644391690M';
                        },
                        product: {
                            ID: '701644391690M',
                            name: 'Gilet a bordure tissee'
                        },
                        productName: 'Gilet a bordure tissee',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 6.29
                };
            },
            getAdjustedShippingTotalTax: function () {
                return {
                    value: 0.30
                };
            }
        }, {
            paymentMethodSpecificInput: {
                financingPaymentMethodSpecificInput: {
                    paymentProductId: 3390
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.amountOfMoney.amount, 7349);
        assert.isUndefined(payload.references.merchantReference);
        assert.equal(payload.references.merchantShopReference, 'RefArch');
        assert.lengthOf(payload.shoppingCart.items, 2);
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productCode, 'SHIPMENT');
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productPrice, 629);
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.taxAmount, 30);
        assert.equal(payload.orderRequest.orderType, 'FULL');
        assert.isUndefined(payload.orderRequest.orderReferences);
        assert.equal(payload.orderRequest.paymentMethodSpecificInput.paymentChannel, 'ECOMMERCE');
    });

    it('should build order payload with derived references and shipment line', function () {
        var model = CreateCheckoutRequest.fromOrder({
            orderNo: '00012345',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 73.49,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return {
                            address1: 'Order Street',
                            city: 'Berlin',
                            postalCode: '10115',
                            countryCode: {
                                value: 'DE'
                            },
                            address2: 'Floor 3',
                            firstName: 'John',
                            lastName: 'Doe'
                        };
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-order-1',
                        getProductID: function () {
                            return 'SKU-ORDER-1';
                        },
                        product: {
                            ID: 'SKU-ORDER-1',
                            name: 'Order Product'
                        },
                        productName: 'Order Product',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 6.29
                };
            },
            getAdjustedShippingTotalTax: function () {
                return {
                    value: 0.30
                };
            }
        }, {
            paymentMethodSpecificInput: {
                financingPaymentMethodSpecificInput: {
                    paymentProductId: 3390
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.amountOfMoney.amount, 7349);
        assert.equal(payload.references.merchantReference, '22200012345');
        assert.equal(payload.references.merchantShopReference, 'RefArch');
        assert.lengthOf(payload.shoppingCart.items, 2);
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productCode, 'SHIPMENT');
        assert.equal(payload.orderRequest.orderReferences.merchantReference, '33300012345');
        assert.equal(payload.shipping.address.street, 'Order Street');
        assert.equal(payload.shipping.address.countryCode, 'DE');
    });

    it('should infer amount from shopping cart when amount is omitted', function () {
        var model = new CreateCheckoutRequest({
            references: {
                merchantReference: 'ck-amount'
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: 'SKU-1',
                            quantity: 2,
                            productPrice: 1000
                        }
                    },
                    {}
                ]
            }
        });

        var payload = model.toRequest();

        assert.equal(model.amountOfMoney.amount, 2000);
        assert.equal(payload.amountOfMoney, undefined);
        assert.equal(payload.shoppingCart.items[0].orderLineDetails.productCode, 'SKU-1');
    });

    it('should subtract discount lines when inferring amount from shopping cart', function () {
        var model = new CreateCheckoutRequest({
            references: {
                merchantReference: 'ck-amount-discount'
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: 'SKU-1',
                            productType: 'GOODS',
                            quantity: 2,
                            productPrice: 1000
                        }
                    },
                    {
                        orderLineDetails: {
                            productCode: 'DISCOUNT-1',
                            productType: 'DISCOUNT',
                            quantity: 1,
                            productPrice: 250
                        }
                    }
                ]
            }
        });

        assert.equal(model.amountOfMoney.amount, 1750);
    });

    it('should build from PAYONE response variants and expose order update data', function () {
        var model = CreateCheckoutRequest.fromPayoneResponse({
            checkouts: [
                {
                    amountOfMoney: {
                        amount: 4499,
                        currencyCode: 'EUR'
                    },
                    references: {
                        merchantReference: 'ck-456'
                    },
                    shoppingCart: {
                        items: [
                            {
                                orderLineDetails: {
                                    productCode: 'SKU-2',
                                    productType: 'GOODS',
                                    quantity: 1,
                                    productPrice: 4499
                                }
                            }
                        ]
                    }
                }
            ]
        });

        var updatePayload = model.toOrderUpdate();

        assert.equal(updatePayload.amountOfMoney.amount, 4499);
        assert.equal(updatePayload.checkoutReferences.merchantReference, 'ck-456');
        assert.lengthOf(updatePayload.shoppingCart.items, 1);
    });

    it('should omit shipping block when address is empty', function () {
        var model = new CreateCheckoutRequest({
            amountOfMoney: {
                amount: 1000,
                currencyCode: 'EUR'
            },
            references: {
                merchantReference: 'ck-empty-shipping'
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: 'SKU-1',
                            quantity: 1,
                            productPrice: 1000
                        }
                    }
                ]
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.shipping, undefined);
    });

    it('should preserve legitimate name values while filtering placeholder state values', function () {
        var model = new CreateCheckoutRequest({
            amountOfMoney: {
                amount: 1000,
                currencyCode: 'EUR'
            },
            references: {
                merchantReference: 'ck-null-name'
            },
            shipping: {
                address: {
                    street: 'Test Street',
                    city: 'Paris',
                    zip: '75003',
                    countryCode: 'FR',
                    state: 'null',
                    name: {
                        firstName: 'Jason',
                        surname: 'Null'
                    }
                }
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: 'SKU-1',
                            quantity: 1,
                            productPrice: 1000
                        }
                    }
                ]
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.shipping.address.state, undefined);
        assert.equal(payload.shipping.address.name.firstName, 'Jason');
        assert.equal(payload.shipping.address.name.surname, 'Null');
    });

    it('should clip long checkout references to PAYONE limits', function () {
        var model = new CreateCheckoutRequest({
            amountOfMoney: {
                amount: 1000,
                currencyCode: 'EUR'
            },
            references: {
                merchantReference: 'ck-1234567890123456789012345678901234567890-extra',
                merchantShopReference: 'shop-1234567890123456789012345678901234567890123456789012345678901234-extra'
            },
            shoppingCart: {
                items: [
                    {
                        orderLineDetails: {
                            productCode: 'SKU-1',
                            quantity: 1,
                            productPrice: 1000
                        }
                    }
                ]
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.references.merchantReference.length, 40);
        assert.equal(payload.references.merchantShopReference.length, 64);
    });

    it('should add shipment line when basket shipping amount is zero', function () {
        var model = CreateCheckoutRequest.fromBasket({
            UUID: 'basket-no-shipping',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 67.20,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return null;
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-1',
                        getProductID: function () {
                            return '701644391690M';
                        },
                        product: {
                            ID: '701644391690M',
                            name: 'Gilet a bordure tissee'
                        },
                        productName: 'Gilet a bordure tissee',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 0
                };
            }
        });

        var payload = model.toRequest();

        assert.lengthOf(payload.shoppingCart.items, 2);
        assert.equal(payload.shoppingCart.items[0].orderLineDetails.productCode, '701644391690M');
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productCode, 'SHIPMENT');
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productPrice, 0);
        assert.isUndefined(payload.shoppingCart.items[1].orderLineDetails.taxAmount);
        assert.isUndefined(payload.shoppingCart.items[1].orderLineDetails.taxAmountPerUnit);
    });

    it('should add discount lines for negative basket-level price adjustments and deduct them from total', function () {
        var model = CreateCheckoutRequest.fromBasket({
            UUID: 'basket-discount',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 63.49,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return null;
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-1',
                        getProductID: function () {
                            return '701644391690M';
                        },
                        product: {
                            ID: '701644391690M',
                            name: 'Gilet a bordure tissee'
                        },
                        productName: 'Gilet a bordure tissee',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 6.29
                };
            },
            getAdjustedShippingTotalTax: function () {
                return {
                    value: 0.30
                };
            },
            getPriceAdjustments: function () {
                return toCollection([
                    {
                        lineItemText: 'Order Level Coupon Test',
                        promotionID: 'PROMO-ORDER',
                        campaignID: 'Campaign-1',
                        getGrossPrice: function () {
                            return {
                                value: -10.00
                            };
                        },
                        getTax: function () {
                            return null;
                        }
                    }
                ]);
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.amountOfMoney.amount, 6349);
        assert.lengthOf(payload.shoppingCart.items, 3);
        assert.equal(payload.shoppingCart.items[2].orderLineDetails.productCode, 'Order Level Coupon Test');
        assert.equal(payload.shoppingCart.items[2].orderLineDetails.productType, 'DISCOUNT');
        assert.equal(payload.shoppingCart.items[2].orderLineDetails.productPrice, 1000);
        assert.equal(payload.shoppingCart.items[2].orderLineDetails.taxAmount, undefined);
        assert.equal(payload.shoppingCart.items[2].invoiceData.description, 'Order Level Coupon Test');
    });

    it('should ignore non-negative basket-level price adjustments', function () {
        var model = CreateCheckoutRequest.fromBasket({
            UUID: 'basket-non-discount-adjustment',
            getCurrencyCode: function () {
                return 'EUR';
            },
            getTotalGrossPrice: function () {
                return {
                    value: 73.49,
                    currencyCode: 'EUR'
                };
            },
            getDefaultShipment: function () {
                return {
                    getShippingAddress: function () {
                        return null;
                    }
                };
            },
            getProductLineItems: function () {
                return toCollection([
                    {
                        UUID: 'pli-1',
                        getProductID: function () {
                            return '701644391690M';
                        },
                        product: {
                            ID: '701644391690M',
                            name: 'Gilet a bordure tissee'
                        },
                        productName: 'Gilet a bordure tissee',
                        quantityValue: 1,
                        adjustedGrossPrice: {
                            value: 67.20
                        },
                        adjustedTax: {
                            value: 3.20
                        }
                    }
                ]);
            },
            getAdjustedShippingTotalGrossPrice: function () {
                return {
                    value: 6.29
                };
            },
            getAdjustedShippingTotalTax: function () {
                return {
                    value: 0.30
                };
            },
            getPriceAdjustments: function () {
                return toCollection([
                    {
                        lineItemText: 'Positive Adjustment',
                        promotionID: 'PROMO-POSITIVE',
                        campaignID: 'Campaign-Positive',
                        getGrossPrice: function () {
                            return {
                                value: 10.00
                            };
                        }
                    },
                    {
                        lineItemText: 'Zero Adjustment',
                        promotionID: 'PROMO-ZERO',
                        campaignID: 'Campaign-Zero',
                        getGrossPrice: function () {
                            return {
                                value: 0
                            };
                        }
                    }
                ]);
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.amountOfMoney.amount, 7349);
        assert.lengthOf(payload.shoppingCart.items, 2);
        assert.equal(payload.shoppingCart.items[0].orderLineDetails.productCode, '701644391690M');
        assert.equal(payload.shoppingCart.items[1].orderLineDetails.productCode, 'SHIPMENT');
    });
});
