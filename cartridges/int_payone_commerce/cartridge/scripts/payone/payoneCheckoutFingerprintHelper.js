'use strict';

var Encoding = require('dw/crypto/Encoding');
var MessageDigest = require('dw/crypto/MessageDigest');
var Bytes = require('dw/util/Bytes');

var CreateCheckoutRequest = require('*/cartridge/scripts/models/payone/CreateCheckoutRequest');
var Customer = require('*/cartridge/scripts/models/payone/Customer');
var OrderRequest = require('*/cartridge/scripts/models/payone/OrderRequest');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var FINGERPRINT_HASH_PREFIX = 'sha256:';
var HASH_CHUNK_SIZE = 2000;

/**
 * Returns the default shipment from a basket or order-like source.
 *
 * @param {dw.order.LineItemCtnr|Object} source - Basket or order source.
 * @returns {dw.order.Shipment|Object|null} Default shipment.
 */
function getDefaultShipment(source) {
    if (!source) {
        return null;
    }

    return typeof source.getDefaultShipment === 'function'
        ? source.getDefaultShipment()
        : source.defaultShipment;
}

/**
 * Returns the selected shipping method id from a shipment-like source.
 *
 * @param {dw.order.Shipment|Object|null} shipment - Shipment source.
 * @returns {string|null} Normalized shipping method id.
 */
function getShippingMethodId(shipment) {
    var shippingMethod;

    if (!shipment) {
        return null;
    }

    shippingMethod = typeof shipment.getShippingMethod === 'function'
        ? shipment.getShippingMethod()
        : shipment.shippingMethod;

    return PayoneCommonUtils.trimString(
        (shippingMethod && (shippingMethod.ID || shippingMethod.id))
            || shipment.shippingMethodID
            || shipment.shippingMethodId,
        true
    );
}

/**
 * Normalizes data before deterministic serialization.
 *
 * @param {*} value - Raw value.
 * @returns {*} Canonical JSON-safe value.
 */
function normalizeValue(value) {
    var normalized;

    if (value === null || typeof value === 'undefined') {
        return null;
    }

    if (typeof value === 'string') {
        return PayoneCommonUtils.trimString(value, true) || null;
    }

    if (Array.isArray(value)) {
        return value.map(function (item) {
            return normalizeValue(item);
        });
    }

    if (typeof value === 'object') {
        normalized = {};

        Object.keys(value).sort().forEach(function (key) {
            var normalizedValue = normalizeValue(value[key]);

            if (normalizedValue !== null) {
                normalized[key] = normalizedValue;
            }
        });

        return normalized;
    }

    return value;
}

/**
 * Serializes a JSON-safe value with stable object key ordering.
 *
 * @param {*} value - Canonical value.
 * @returns {string} Stable JSON representation.
 */
function stableSerialize(value) {
    if (value === null || typeof value === 'undefined') {
        return 'null';
    }

    if (Array.isArray(value)) {
        return '[' + value.map(stableSerialize).join(',') + ']';
    }

    if (typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(function (key) {
            return JSON.stringify(key) + ':' + stableSerialize(value[key]);
        }).join(',') + '}';
    }

    return JSON.stringify(value);
}

/**
 * Creates a SHA-256 hash using SFCC crypto APIs without storing the serialized payload.
 *
 * @param {string} serializedValue - Stable serialized snapshot.
 * @returns {string} SHA-256 hash with algorithm prefix.
 */
function sha256Hex(serializedValue) {
    var digest = new MessageDigest(MessageDigest.DIGEST_SHA_256);
    var text = String(serializedValue || '');
    var i;

    for (i = 0; i < text.length; i += HASH_CHUNK_SIZE) {
        digest.updateBytes(new Bytes(text.substring(i, i + HASH_CHUNK_SIZE), 'UTF-8'));
    }

    return FINGERPRINT_HASH_PREFIX + Encoding.toHex(digest.digest());
}

/**
 * Normalizes and sorts shopping-cart items so item order does not change the fingerprint.
 *
 * @param {Array<Object>} items - PAYONE shopping-cart items.
 * @returns {Array<Object>} Canonical sorted items.
 */
function normalizeShoppingCartItems(items) {
    return (items || []).map(function (item) {
        return normalizeValue(item);
    }).sort(function (left, right) {
        var leftSerialized = stableSerialize(left);
        var rightSerialized = stableSerialize(right);

        if (leftSerialized < rightSerialized) {
            return -1;
        }

        if (leftSerialized > rightSerialized) {
            return 1;
        }

        return 0;
    });
}

/**
 * Keeps only customer fields that represent checkout/payment-relevant data.
 *
 * @param {Object} customerPayload - PAYONE customer request payload.
 * @returns {Object} Canonical customer fingerprint payload.
 */
function buildCustomerFingerprintPayload(customerPayload) {
    var safeCustomer = customerPayload || {};

    return normalizeValue({
        billingAddress: safeCustomer.billingAddress || null,
        businessRelation: safeCustomer.businessRelation || null,
        companyInformation: safeCustomer.companyInformation || null,
        contactDetails: safeCustomer.contactDetails || null,
        fiscalNumber: safeCustomer.fiscalNumber || null,
        personalInformation: safeCustomer.personalInformation || null
    });
}

/**
 * Builds the canonical checkout snapshot used for stored context validation.
 *
 * @param {dw.order.Basket|dw.order.Order|Object} source - Basket or order source.
 * @param {string} sourceType - `basket` or `order`.
 * @param {Object} options - Snapshot options.
 * @param {string} options.paymentMethodId - Payment method id.
 * @param {string|null} [options.basketUUID] - Original basket UUID.
 * @param {Object|null} [options.customerOverride] - Checkout-specific customer override payload.
 * @returns {Object|null} Canonical snapshot object.
 */
function buildCheckoutSnapshot(source, sourceType, options) {
    var safeOptions = options || {};
    var isOrder = sourceType === 'order';
    var checkoutModel;
    var checkoutPayload;
    var customerPayload;
    var defaultShipment;

    if (!source || !safeOptions.paymentMethodId) {
        return null;
    }

    checkoutModel = isOrder
        ? CreateCheckoutRequest.fromOrder(source, new OrderRequest({}))
        : CreateCheckoutRequest.fromBasket(source, new OrderRequest({}));
    checkoutPayload = checkoutModel.toRequest();
    customerPayload = isOrder
        ? Customer.fromOrder(source, safeOptions.customerOverride).toRequest()
        : Customer.fromBasket(source, safeOptions.customerOverride).toRequest();
    defaultShipment = getDefaultShipment(source);

    return normalizeValue({
        version: 2,
        paymentMethodId: safeOptions.paymentMethodId,
        basketUUID: safeOptions.basketUUID || source.UUID || null,
        amountOfMoney: checkoutPayload.amountOfMoney || null,
        customer: buildCustomerFingerprintPayload(customerPayload),
        shipping: checkoutPayload.shipping || null,
        shippingMethodId: getShippingMethodId(defaultShipment),
        shoppingCart: {
            items: normalizeShoppingCartItems(
                checkoutPayload.shoppingCart && checkoutPayload.shoppingCart.items
            )
        }
    });
}

/**
 * Builds the SHA-256 fingerprint hash for a basket or order source.
 *
 * @param {dw.order.Basket|dw.order.Order|Object} source - Basket or order source.
 * @param {string} sourceType - `basket` or `order`.
 * @param {Object} options - Snapshot options.
 * @param {dw.system.Logger} [logger] - Optional logger.
 * @param {string} [logLabel] - Optional log label.
 * @returns {string|null} Fingerprint hash or null when it cannot be built.
 */
function buildFingerprintHash(source, sourceType, options, logger, logLabel) {
    var snapshot;

    try {
        snapshot = buildCheckoutSnapshot(source, sourceType, options);
        return snapshot ? sha256Hex(stableSerialize(snapshot)) : null;
    } catch (e) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn(
                'Could not build {0} checkout fingerprint for {1}: {2}',
                logLabel || 'PAYONE',
                sourceType || 'unknown',
                e && e.message ? e.message : e
            );
        }

        return null;
    }
}

module.exports = {
    buildFingerprintHash: buildFingerprintHash,
    normalizeShoppingCartItems: normalizeShoppingCartItems,
    normalizeValue: normalizeValue,
    stableSerialize: stableSerialize
};
