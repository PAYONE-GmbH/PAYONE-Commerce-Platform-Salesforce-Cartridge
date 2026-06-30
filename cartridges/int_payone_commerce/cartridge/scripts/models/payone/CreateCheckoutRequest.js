'use strict';

var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');
var CartItemInput = require('*/cartridge/scripts/models/payone/CartItemInput');
var CheckoutReferences = require('*/cartridge/scripts/models/payone/CheckoutReferences');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');
var OrderRequest = require('*/cartridge/scripts/models/payone/OrderRequest');

var LOGGER = Logger.getLogger('payone', 'models');

var trimString = PayoneCommonUtils.trimString;
var getMoneyInCents = PayoneCommonUtils.getMoneyInCents;
var toArray = PayoneCommonUtils.toArray;

/**
 * Maps a generic address object into the PAYONE checkout address shape.
 *
 * @param {Object} address - Address-like input.
 * @returns {Object} Normalized address payload.
 */
function mapAddressFromInput(address) {
    var safeAddress = address || {};
    var nameSource = safeAddress.name || {};
    var firstName = trimString(nameSource.firstName || safeAddress.firstName);
    var surname = trimString(nameSource.surname || safeAddress.lastName);
    var title = trimString(nameSource.title || safeAddress.title);
    var countryCode = trimString(safeAddress.countryCode ? String(safeAddress.countryCode).toUpperCase() : null);
    var mapped = {
        street: trimString(safeAddress.street),
        city: trimString(safeAddress.city),
        zip: trimString(safeAddress.zip),
        countryCode: countryCode,
        additionalInfo: trimString(safeAddress.additionalInfo || safeAddress.address2),
        state: trimString(safeAddress.state, true)
    };

    if (firstName || surname || title) {
        mapped.name = {
            firstName: firstName || null,
            surname: surname || null,
            title: title || null
        };
    }

    return mapped;
}

/**
 * Maps an SFCC address object into the PAYONE checkout address shape.
 *
 * @param {dw.order.OrderAddress|Object} address - SFCC address input.
 * @returns {Object} Normalized PAYONE address payload.
 */
function mapAddressFromSFCC(address) {
    var safeAddress = address || {};
    var country = safeAddress.countryCode && safeAddress.countryCode.value
        ? safeAddress.countryCode.value
        : safeAddress.countryCode;

    return mapAddressFromInput({
        street: safeAddress.address1,
        city: safeAddress.city,
        zip: safeAddress.postalCode,
        countryCode: country,
        additionalInfo: safeAddress.address2,
        state: safeAddress.stateCode,
        firstName: safeAddress.firstName,
        lastName: safeAddress.lastName,
        title: safeAddress.title
    });
}

/**
 * Calculates the checkout total from cart items when no explicit amount is provided.
 *
 * @param {Array<Object>} items - PAYONE cart item request payloads.
 * @returns {number} Shopping cart total in cents.
 */
function getShoppingCartAmount(items) {
    var safeItems = items || [];
    var total = 0;
    var i;
    var quantity;
    var productPrice;
    var lineAmount;
    var productType;

    for (i = 0; i < safeItems.length; i += 1) {
        var details = safeItems[i].orderLineDetails || {};
        quantity = Number(details.quantity);
        productPrice = Number(details.productPrice);
        productType = trimString(details.productType);
        // eslint-disable-next-line no-restricted-globals
        lineAmount = (isNaN(quantity) ? 0 : quantity) * (isNaN(productPrice) ? 0 : productPrice);

        if (productType === 'DISCOUNT') {
            total -= lineAmount;
        } else {
            total += lineAmount;
        }
    }

    return total;
}

/**
 * Builds a non-product cart item such as shipping.
 *
 * @param {string} id - Product code to assign.
 * @param {string} productType - PAYONE product type.
 * @param {number} amount - Gross amount in cents.
 * @param {string} description - Human-readable description.
 * @param {number|null} taxAmount - Tax amount in cents.
 * @param {boolean} taxAmountPerUnit - Whether tax is unit-based.
 * @returns {Object} PAYONE cart item payload.
 */
function createNonProductLineItem(id, productType, amount, description, taxAmount, taxAmountPerUnit) {
    var item = {
        invoiceData: {
            description: description
        },
        orderLineDetails: {
            productCode: id,
            productType: productType,
            quantity: 1,
            productPrice: amount
        }
    };

    if (taxAmount !== null && typeof taxAmount !== 'undefined' && taxAmount !== 0) {
        item.orderLineDetails.taxAmount = taxAmount;
        item.orderLineDetails.taxAmountPerUnit = !!taxAmountPerUnit;
    }

    return item;
}

/**
 * Appends additional non-product basket costs, currently shipping, to the checkout cart.
 *
 * @param {Array<Object>} shoppingCartItems - Current checkout cart items.
 * @param {dw.order.Basket|Object} basket - SFCC basket source.
 * @returns {undefined}
 */
function appendAdditionalCostItems(shoppingCartItems, basket) {
    var safeBasket = basket || {};
    var shippingTaxAmount = typeof safeBasket.getAdjustedShippingTotalTax === 'function'
        ? getMoneyInCents(safeBasket.getAdjustedShippingTotalTax())
        : null;
    var shippingAmount = typeof safeBasket.getAdjustedShippingTotalGrossPrice === 'function'
        ? getMoneyInCents(safeBasket.getAdjustedShippingTotalGrossPrice())
        : null;

    if (shippingAmount !== null) {
        shoppingCartItems.push(createNonProductLineItem('SHIPMENT', 'SHIPMENT', shippingAmount, 'Shipping', shippingTaxAmount, false));
    }

    var basketLevelAdjustments = typeof basket.getPriceAdjustments === 'function'
        ? toArray(basket.getPriceAdjustments())
        : [];

    basketLevelAdjustments.forEach(function (adjustment, index) {
        var indexPlusOne = index + 1;
        var rawAdjustmentAmount = getMoneyInCents(adjustment.getGrossPrice());

        if (rawAdjustmentAmount === null || rawAdjustmentAmount >= 0) {
            return;
        }

        var adjustmentCode = trimString(adjustment.lineItemText || adjustment.promotionID || adjustment.campaignID || 'DISCOUNT-' + indexPlusOne);
        var adjustmentDescription = trimString(adjustment.lineItemText || adjustment.promotionID || adjustment.campaignID || 'Order Discount ' + indexPlusOne);
        var adjustmentAmount = Math.abs(rawAdjustmentAmount);
        shoppingCartItems.push(createNonProductLineItem(adjustmentCode, 'DISCOUNT', adjustmentAmount, adjustmentDescription, null, null));
    });
}

/**
 * Normalizes and filters cart items for request serialization.
 *
 * @param {Array<Object>} items - Raw cart item sources.
 * @returns {Array<Object>} Sanitized PAYONE cart item request payloads.
 */
function sanitizeLineItems(items) {
    var normalized = (items || []).map(function (item) {
        return new CartItemInput(item);
    });
    var sanitized = [];
    var i;

    for (i = 0; i < normalized.length; i += 1) {
        var nextItem = normalized[i].toRequest();

        if (nextItem.orderLineDetails && Object.keys(nextItem.orderLineDetails).length > 0) {
            sanitized.push(nextItem);
        }
    }

    return sanitized;
}

/**
 * Builds the checkout amount object from explicit input or cart-derived totals.
 *
 * @param {Object} amountOfMoneySource - Amount source object.
 * @param {Array<Object>} shoppingCartItems - Sanitized cart items.
 * @returns {Object} Normalized amount object with `amount` and `currencyCode`.
 */
function buildAmountOfMoney(amountOfMoneySource, shoppingCartItems) {
    var safeAmount = amountOfMoneySource || {};
    var amount = Number(safeAmount.amount);
    var currencyCode = trimString(safeAmount.currencyCode);

    // eslint-disable-next-line no-restricted-globals
    if (isNaN(amount)) {
        amount = getShoppingCartAmount(shoppingCartItems);
    }

    return {
        amount: amount,
        currencyCode: currencyCode ? currencyCode.toUpperCase() : null
    };
}

/**
 * Logs the difference between the native SFCC basket total and the PAYONE cart-derived total.
 *
 * @param {boolean} sourceIsBasket - Whether the source entity is a basket.
 * @param {string} sourceIdentifier - Source identifier.
 * @param {number|null} sfccTotalInCents - SFCC source total in cents.
 * @param {number} payoneCalculatedTotalInCents - PAYONE cart-derived total in cents.
 * @returns {undefined}
 */
function logRoundingDifference(sourceIsBasket, sourceIdentifier, sfccTotalInCents, payoneCalculatedTotalInCents) {
    var roundingDifferenceInCents;
    var sourceType = sourceIsBasket ? 'basket' : 'order';

    if (sfccTotalInCents === null || sfccTotalInCents === payoneCalculatedTotalInCents) {
        return;
    }

    roundingDifferenceInCents = payoneCalculatedTotalInCents - sfccTotalInCents;

    LOGGER.warn(
        'PAYONE rounding difference detected for {0} {1}. SFCC total={2} cents, PAYONE calculated total={3} cents, difference={4} cents. PAYONE calculated total will be used as source of truth.',
        sourceType || 'source',
        sourceIdentifier || 'n/a',
        sfccTotalInCents,
        payoneCalculatedTotalInCents,
        roundingDifferenceInCents
    );
}

/**
 * PAYONE checkout creation request model.
 *
 * @param {Object} source - Checkout source payload.
 * @constructor
 */
function CreateCheckoutRequest(source) {
    var safeSource = source || {};
    var rawItems = (safeSource.shoppingCart && safeSource.shoppingCart.items) || safeSource.items || [];
    var shoppingCartItems = sanitizeLineItems(rawItems);

    this.shoppingCart = {
        items: shoppingCartItems
    };
    this.amountOfMoney = buildAmountOfMoney(safeSource.amountOfMoney || {}, shoppingCartItems);
    this.references = new CheckoutReferences(safeSource.references || {});
    this.shipping = {
        address: mapAddressFromInput((safeSource.shipping && safeSource.shipping.address) || {})
    };
    this.orderRequest = new OrderRequest(safeSource.orderRequest || {});
    this.autoExecuteOrder = typeof safeSource.autoExecuteOrder === 'boolean' ? safeSource.autoExecuteOrder : true;
}

/**
 * Builds the PAYONE checkout creation request payload.
 *
 * @returns {Object} PAYONE checkout request payload.
 */
CreateCheckoutRequest.prototype.toRequest = function () {
    var payload = {
        autoExecuteOrder: this.autoExecuteOrder
    };
    var orderRequestPayload = this.orderRequest.toRequest();
    var shippingAddress = this.shipping.address || {};
    var shippingAddressPayload = {};
    var shippingNamePayload = {};

    if (this.amountOfMoney.amount !== null && this.amountOfMoney.currencyCode) {
        payload.amountOfMoney = {
            amount: this.amountOfMoney.amount,
            currencyCode: this.amountOfMoney.currencyCode
        };
    }

    if (this.references.merchantReference || this.references.merchantShopReference) {
        payload.references = {};
        if (this.references.merchantReference) {
            payload.references.merchantReference = this.references.merchantReference;
        }
        if (this.references.merchantShopReference) {
            payload.references.merchantShopReference = this.references.merchantShopReference;
        }
    }

    if (shippingAddress.street) {
        shippingAddressPayload.street = shippingAddress.street;
    }
    if (shippingAddress.city) {
        shippingAddressPayload.city = shippingAddress.city;
    }
    if (shippingAddress.zip) {
        shippingAddressPayload.zip = shippingAddress.zip;
    }
    if (shippingAddress.countryCode) {
        shippingAddressPayload.countryCode = shippingAddress.countryCode;
    }
    if (shippingAddress.additionalInfo) {
        shippingAddressPayload.additionalInfo = shippingAddress.additionalInfo;
    }
    if (shippingAddress.state) {
        shippingAddressPayload.state = shippingAddress.state;
    }

    if (shippingAddress.name && shippingAddress.name.firstName) {
        shippingNamePayload.firstName = shippingAddress.name.firstName;
    }
    if (shippingAddress.name && shippingAddress.name.surname) {
        shippingNamePayload.surname = shippingAddress.name.surname;
    }
    if (shippingAddress.name && shippingAddress.name.title) {
        shippingNamePayload.title = shippingAddress.name.title;
    }
    if (Object.keys(shippingNamePayload).length) {
        shippingAddressPayload.name = shippingNamePayload;
    }

    if (Object.keys(shippingAddressPayload).length) {
        payload.shipping = {
            address: shippingAddressPayload
        };
    }

    if (this.shoppingCart.items.length) {
        payload.shoppingCart = this.shoppingCart;
    }

    if (Object.keys(orderRequestPayload).length) {
        payload.orderRequest = orderRequestPayload;
    }

    return payload;
};

/**
 * Creates a checkout request from an SFCC basket.
 *
 * @param {dw.order.Basket|Object} basket - SFCC basket source.
 * @param {OrderRequest|Object} [orderRequest] - Optional PAYONE order request input.
 * @param {boolean} [autoExecuteOrder=true] - Whether PAYONE should execute the payment during checkout creation.
 * @returns {CreateCheckoutRequest} Checkout request model.
 */
CreateCheckoutRequest.fromBasket = function (basket, orderRequest, autoExecuteOrder) {
    var basketUUID = basket.UUID;
    var totalGrossPrice = basket.getTotalGrossPrice();
    var sfccTotalInCents = getMoneyInCents(totalGrossPrice);
    var defaultShipment = basket.getDefaultShipment();
    var shippingAddress = defaultShipment ? defaultShipment.getShippingAddress() : null;
    var currencyCode = basket.getCurrencyCode() || (totalGrossPrice && totalGrossPrice.currencyCode);
    var rawProductLineItems = basket.getProductLineItems();
    var normalizedOrderRequest = orderRequest instanceof OrderRequest
        ? orderRequest
        : new OrderRequest(orderRequest || {});
    var shoppingCartItems = toArray(rawProductLineItems).map(function (item) {
        return new CartItemInput(item).toRequest();
    });
    var payoneCalculatedTotalInCents;

    appendAdditionalCostItems(shoppingCartItems, basket);
    payoneCalculatedTotalInCents = getShoppingCartAmount(shoppingCartItems);
    logRoundingDifference(true, basketUUID, sfccTotalInCents, payoneCalculatedTotalInCents);

    return new CreateCheckoutRequest({
        amountOfMoney: {
            amount: payoneCalculatedTotalInCents,
            currencyCode: currencyCode
        },
        autoExecuteOrder: typeof autoExecuteOrder === 'boolean' ? autoExecuteOrder : undefined,
        references: {
            merchantShopReference: Site.current.ID
        },
        shipping: {
            address: mapAddressFromSFCC(shippingAddress)
        },
        shoppingCart: {
            items: shoppingCartItems
        },
        orderRequest: normalizedOrderRequest
    });
};

/**
 * Creates a checkout request from an SFCC order.
 *
 * @param {dw.order.Order|Object} order - SFCC order source.
 * @param {OrderRequest|Object} [orderRequest] - Optional PAYONE order request input.
 * @param {boolean} [autoExecuteOrder=true] - Whether PAYONE should execute the payment during checkout creation.
 * @returns {CreateCheckoutRequest} Checkout request model.
 */
CreateCheckoutRequest.fromOrder = function (order, orderRequest, autoExecuteOrder) {
    var safeOrder = order || {};
    var orderNo = safeOrder.orderNo || (typeof safeOrder.getOrderNo === 'function' ? safeOrder.getOrderNo() : null);
    var checkoutReference = payoneMerchantReferenceHelper.buildCheckoutReference(orderNo);
    var orderReference = payoneMerchantReferenceHelper.buildPaymentReference(orderNo);
    var totalGrossPrice = typeof safeOrder.getTotalGrossPrice === 'function'
        ? safeOrder.getTotalGrossPrice()
        : safeOrder.totalGrossPrice;
    var sfccTotalInCents = getMoneyInCents(totalGrossPrice);
    var defaultShipment = typeof safeOrder.getDefaultShipment === 'function'
        ? safeOrder.getDefaultShipment()
        : safeOrder.defaultShipment;
    var shippingAddress = null;
    var currencyCode = (
        (typeof safeOrder.getCurrencyCode === 'function' ? safeOrder.getCurrencyCode() : safeOrder.currencyCode)
        || (totalGrossPrice && totalGrossPrice.currencyCode)
    );
    var rawProductLineItems = typeof safeOrder.getProductLineItems === 'function'
        ? safeOrder.getProductLineItems()
        : safeOrder.productLineItems;
    var normalizedOrderRequest = orderRequest instanceof OrderRequest
        ? orderRequest
        : new OrderRequest(orderRequest || {});
    var shoppingCartItems = toArray(rawProductLineItems).map(function (item) {
        return new CartItemInput(item).toRequest();
    });
    var payoneCalculatedTotalInCents;

    if (defaultShipment) {
        shippingAddress = typeof defaultShipment.getShippingAddress === 'function'
            ? defaultShipment.getShippingAddress()
            : defaultShipment.shippingAddress;
    }

    normalizedOrderRequest.orderReferences = normalizedOrderRequest.orderReferences || {};
    if (!normalizedOrderRequest.orderReferences.merchantReference) {
        normalizedOrderRequest.orderReferences.merchantReference = orderReference;
    }

    appendAdditionalCostItems(shoppingCartItems, safeOrder);
    payoneCalculatedTotalInCents = getShoppingCartAmount(shoppingCartItems);
    logRoundingDifference(false, orderNo, sfccTotalInCents, payoneCalculatedTotalInCents);

    return new CreateCheckoutRequest({
        amountOfMoney: {
            amount: payoneCalculatedTotalInCents,
            currencyCode: currencyCode
        },
        autoExecuteOrder: typeof autoExecuteOrder === 'boolean' ? autoExecuteOrder : undefined,
        references: {
            merchantReference: checkoutReference,
            merchantShopReference: Site.current.ID
        },
        shipping: {
            address: mapAddressFromSFCC(shippingAddress)
        },
        shoppingCart: {
            items: shoppingCartItems
        },
        orderRequest: normalizedOrderRequest
    });
};

/**
 * Creates a checkout request model from a PAYONE checkout response.
 *
 * @param {Object} payoneResponse - PAYONE response containing checkout data.
 * @returns {CreateCheckoutRequest} Checkout request model.
 */
CreateCheckoutRequest.fromPayoneResponse = function (payoneResponse) {
    var safeResponse = payoneResponse || {};
    var checkout = safeResponse.checkout
        || (safeResponse.checkouts && safeResponse.checkouts[0])
        || safeResponse;

    return new CreateCheckoutRequest({
        amountOfMoney: checkout.amountOfMoney || {},
        references: checkout.references || {},
        shipping: checkout.shipping || {},
        shoppingCart: checkout.shoppingCart || {}
    });
};

/**
 * Converts the model into a normalized order update payload.
 *
 * @returns {Object} Normalized order update data.
 */
CreateCheckoutRequest.prototype.toOrderUpdate = function () {
    return {
        amountOfMoney: this.amountOfMoney,
        checkoutReferences: this.references,
        shipping: this.shipping,
        shoppingCart: this.shoppingCart
    };
};

module.exports = CreateCheckoutRequest;
