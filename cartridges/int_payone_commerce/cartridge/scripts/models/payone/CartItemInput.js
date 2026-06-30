'use strict';

var Site = require('dw/system/Site');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;
var getMoneyInCents = PayoneCommonUtils.getMoneyInCents;
var toArray = PayoneCommonUtils.toArray;
var toInt = PayoneCommonUtils.toInt;

/**
 * Normalizes supplier references to the PAYONE cart item shape.
 *
 * @param {Object} source - Raw supplier reference input.
 * @returns {Object|null} Normalized supplier references or null when empty.
 */
function normalizeSupplierReferences(source) {
    var safeSource = source || {};
    var payload = {
        supplierId: trimString(safeSource.supplierId),
        orderReference: trimString(safeSource.orderReference)
    };

    if (!payload.supplierId && !payload.orderReference) {
        return null;
    }

    return payload;
}

/**
 * Reads adjusted tax from an SFCC line item and falls back to tax when needed.
 *
 * @param {Object} item - SFCC product or option line item.
 * @returns {number|null} Tax amount in cents.
 */
function getAdjustedTaxInCents(item) {
    var safeItem = item || {};
    var adjustedTax = getMoneyInCents(safeItem.adjustedTax);

    if (adjustedTax === null) {
        return getMoneyInCents(safeItem.tax);
    }

    return adjustedTax;
}

/**
 * Aggregates option line item totals into cent-based amounts.
 *
 * @param {Object} item - SFCC product line item that may contain options.
 * @returns {{adjustedPrice:number, adjustedGrossPrice:number, tax:number, hasAdjustedPrice:boolean, hasAdjustedGrossPrice:boolean, hasTax:boolean}} Aggregated option totals.
 */
function getOptionLineItemTotals(item) {
    var optionItems = toArray(item && item.optionProductLineItems);
    var totals = {
        adjustedPrice: 0,
        adjustedGrossPrice: 0,
        tax: 0,
        hasAdjustedPrice: false,
        hasAdjustedGrossPrice: false,
        hasTax: false
    };
    var i;

    for (i = 0; i < optionItems.length; i += 1) {
        var optionItem = optionItems[i] || {};
        var adjustedPrice = getMoneyInCents(optionItem.adjustedPrice);
        var adjustedGrossPrice = getMoneyInCents(optionItem.adjustedGrossPrice);
        var tax = getAdjustedTaxInCents(optionItem);

        if (adjustedPrice !== null) {
            totals.adjustedPrice += adjustedPrice;
            totals.hasAdjustedPrice = true;
        }

        if (adjustedGrossPrice !== null) {
            totals.adjustedGrossPrice += adjustedGrossPrice;
            totals.hasAdjustedGrossPrice = true;
        }

        if (tax !== null) {
            totals.tax += tax;
            totals.hasTax = true;
        }
    }

    if (!totals.hasAdjustedGrossPrice && totals.hasAdjustedPrice) {
        totals.adjustedGrossPrice = totals.adjustedPrice + (totals.hasTax ? totals.tax : 0);
        totals.hasAdjustedGrossPrice = true;
    }

    return totals;
}

/**
 * Normalizes a PAYONE-shaped cart item into the internal model representation.
 *
 * @param {Object} item - PAYONE-like cart item input.
 * @returns {Object} Normalized cart item payload.
 */
function normalizePayoneItem(item) {
    var safeItem = item || {};
    var details = safeItem.orderLineDetails || {};
    var quantity = toInt(details.quantity);
    var productPrice = toInt(details.productPrice);
    var supplierReferences = normalizeSupplierReferences(safeItem.supplierReferences);
    var payload = {
        orderLineDetails: {
            id: trimString(details.id),
            productCode: trimString(details.productCode),
            productType: trimString(details.productType || 'GOODS'),
            quantity: quantity && quantity > 0 ? quantity : 1,
            productPrice: productPrice !== null && productPrice >= 0 ? productPrice : 0
        }
    };

    if (details.taxAmount !== null && typeof details.taxAmount !== 'undefined') {
        payload.orderLineDetails.taxAmount = toInt(details.taxAmount);
    }
    if (details.taxAmountPerUnit !== null && typeof details.taxAmountPerUnit !== 'undefined') {
        payload.orderLineDetails.taxAmountPerUnit = !!details.taxAmountPerUnit;
    }
    if (details.productUrl) {
        payload.orderLineDetails.productUrl = trimString(details.productUrl);
    }
    if (details.productImageUrl) {
        payload.orderLineDetails.productImageUrl = trimString(details.productImageUrl);
    }
    if (details.productCategoryPath) {
        payload.orderLineDetails.productCategoryPath = trimString(details.productCategoryPath);
    }
    if (details.merchantShopDeliveryReference) {
        payload.orderLineDetails.merchantShopDeliveryReference = trimString(details.merchantShopDeliveryReference);
    }
    if (safeItem.invoiceData && safeItem.invoiceData.description) {
        payload.invoiceData = {
            description: trimString(safeItem.invoiceData.description)
        };
    }
    if (supplierReferences) {
        payload.supplierReferences = supplierReferences;
    }

    return payload;
}

/**
 * Maps an SFCC product line item into a PAYONE cart item representation.
 *
 * @param {dw.order.ProductLineItem|Object} item - SFCC product line item.
 * @returns {Object} Normalized PAYONE cart item payload.
 */
function normalizeSFCCProductLineItem(item) {
    var safeItem = item || {};
    var quantity = toInt(safeItem.quantityValue);
    var optionTotals = getOptionLineItemTotals(safeItem);
    var adjustedPrice = getMoneyInCents(safeItem.adjustedPrice);
    var adjustedGrossPrice = getMoneyInCents(safeItem.adjustedGrossPrice);
    var lineTaxCents = getAdjustedTaxInCents(safeItem);
    var netLinePriceCents;
    var grossLinePriceCents;
    var unitPriceCents;

    if (lineTaxCents === null && optionTotals.hasTax) {
        lineTaxCents = 0;
    }
    if (lineTaxCents !== null && optionTotals.hasTax) {
        lineTaxCents += optionTotals.tax;
    }

    if (adjustedGrossPrice !== null) {
        grossLinePriceCents = adjustedGrossPrice;
    } else {
        netLinePriceCents = adjustedPrice;
        if (netLinePriceCents === null && optionTotals.hasAdjustedPrice) {
            netLinePriceCents = 0;
        }
        if (netLinePriceCents !== null && optionTotals.hasAdjustedPrice) {
            netLinePriceCents += optionTotals.adjustedPrice;
        }
        if (netLinePriceCents !== null) {
            grossLinePriceCents = netLinePriceCents + (lineTaxCents || 0);
        }
    }

    if (grossLinePriceCents !== null && adjustedGrossPrice !== null && optionTotals.hasAdjustedGrossPrice) {
        grossLinePriceCents += optionTotals.adjustedGrossPrice;
    }

    unitPriceCents = quantity && quantity > 0 && grossLinePriceCents !== null
        ? Math.round(grossLinePriceCents / quantity)
        : 0;

    return normalizePayoneItem({
        orderLineDetails: {
            id: trimString(safeItem.UUID),
            productCode: trimString(safeItem.productID || (safeItem.product && safeItem.product.ID)),
            productType: 'GOODS',
            quantity: quantity && quantity > 0 ? quantity : 1,
            productPrice: unitPriceCents || 0,
            taxAmount: lineTaxCents,
            taxAmountPerUnit: lineTaxCents !== null ? false : null,
            merchantShopDeliveryReference: Site.current.ID
        },
        invoiceData: {
            description: trimString(safeItem.productName || (safeItem.product && safeItem.product.name) || safeItem.lineItemText)
        }
    });
}

/**
 * Detects whether an object behaves like an SFCC product line item.
 *
 * @param {Object} item - Candidate item.
 * @returns {boolean} True when the object looks like an SFCC product line item.
 */
function isSFCCProductLineItem(item) {
    return !!(item && typeof item.getProductID === 'function');
}

/**
 * PAYONE cart item input model.
 *
 * @param {Object} source - PAYONE-like item input or SFCC product line item.
 * @constructor
 */
function CartItemInput(source) {
    var normalized = isSFCCProductLineItem(source) ? normalizeSFCCProductLineItem(source) : normalizePayoneItem(source);

    this.invoiceData = normalized.invoiceData || null;
    this.orderLineDetails = normalized.orderLineDetails || {};
    this.supplierReferences = normalized.supplierReferences || null;
}

/**
 * Builds the request-safe PAYONE cart item payload.
 *
 * @returns {Object} PAYONE cart item request payload.
 */
CartItemInput.prototype.toRequest = function () {
    var details = this.orderLineDetails || {};
    var requestDetails = {};
    var payload = {};
    var isZeroPriceItem = Number(details.productPrice) === 0;

    if (details.productCode) {
        requestDetails.productCode = details.productCode;
    }
    if (details.productType) {
        requestDetails.productType = details.productType;
    }
    if (typeof details.quantity !== 'undefined' && details.quantity !== null) {
        requestDetails.quantity = details.quantity;
    }
    if (typeof details.productPrice !== 'undefined' && details.productPrice !== null) {
        requestDetails.productPrice = details.productPrice;
    }
    if (!isZeroPriceItem && typeof details.taxAmount !== 'undefined' && details.taxAmount !== null) {
        requestDetails.taxAmount = details.taxAmount;
    }
    if (!isZeroPriceItem && typeof details.taxAmountPerUnit !== 'undefined' && details.taxAmountPerUnit !== null) {
        requestDetails.taxAmountPerUnit = details.taxAmountPerUnit;
    }
    if (details.productUrl) {
        requestDetails.productUrl = details.productUrl;
    }
    if (details.productImageUrl) {
        requestDetails.productImageUrl = details.productImageUrl;
    }
    if (details.productCategoryPath) {
        requestDetails.productCategoryPath = details.productCategoryPath;
    }
    if (details.merchantShopDeliveryReference) {
        requestDetails.merchantShopDeliveryReference = details.merchantShopDeliveryReference;
    }

    payload.orderLineDetails = requestDetails;

    if (this.invoiceData && this.invoiceData.description) {
        payload.invoiceData = {
            description: this.invoiceData.description
        };
    }
    if (this.supplierReferences) {
        payload.supplierReferences = this.supplierReferences;
    }

    return payload;
};

/**
 * Builds a normalized order update payload retaining internal item metadata.
 *
 * @returns {Object} Normalized order update payload.
 */
CartItemInput.prototype.toOrderUpdate = function () {
    return {
        invoiceData: this.invoiceData,
        orderLineDetails: this.orderLineDetails,
        supplierReferences: this.supplierReferences
    };
};

module.exports = CartItemInput;
