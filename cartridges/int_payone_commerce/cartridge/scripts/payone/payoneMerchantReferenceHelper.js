'use strict';

var SecureRandom = require('dw/crypto/SecureRandom');
var Logger = require('dw/system/Logger');

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var LOGGER = Logger.getLogger('payone', 'merchantReference');
var MAX_COMMERCE_CASE_REFERENCE_LENGTH = 40;
var MAX_CHECKOUT_REFERENCE_LENGTH = 40;
var MAX_PAYMENT_REFERENCE_LENGTH = 20;
var MAX_ACTION_REFERENCE_LENGTH = 20;
var MAX_SEPA_MANDATE_REFERENCE_LENGTH = 35;

var COMMERCE_CASE_PREFIX = '111';
var CHECKOUT_PREFIX = '222';
var ORDER_PREFIX = '333';
var CAPTURE_PREFIX = '444';
var REFUND_PREFIX = '555';
var SEPA_MANDATE_PREFIX = '666';

/**
 * Normalizes an SFCC order number.
 *
 * @param {string|null} orderNo - Order number input.
 * @returns {string|null} Normalized order number.
 */
function normalizeOrderNo(orderNo) {
    return PayoneCommonUtils.trimString(orderNo, true) || null;
}

/**
 * Builds a PAYONE reference from an order number and numeric prefix.
 *
 * @param {string} prefix - PAYONE numeric reference prefix.
 * @param {string|null} orderNo - SFCC order number.
 * @param {number} maxLength - PAYONE field max length.
 * @returns {string|null} Reference value or null.
 */
function buildPrefixedReference(prefix, orderNo, maxLength) {
    var normalizedOrderNo = normalizeOrderNo(orderNo);
    var merchantReference = normalizedOrderNo ? prefix + normalizedOrderNo : null;

    return merchantReference && merchantReference.length <= maxLength ? merchantReference : null;
}

/**
 * Validates one PAYONE merchant reference generated from an SFCC order number.
 *
 * @param {string} referenceName - Reference name for backend logs.
 * @param {string} prefix - PAYONE numeric reference prefix.
 * @param {string|null} orderNo - SFCC order number.
 * @param {number} maxLength - PAYONE field max length.
 * @returns {boolean} True when the reference can be safely sent to PAYONE.
 */
function isPrefixedReferenceValid(referenceName, prefix, orderNo, maxLength) {
    var normalizedOrderNo = normalizeOrderNo(orderNo);
    var merchantReference = normalizedOrderNo ? prefix + normalizedOrderNo : null;

    if (!merchantReference) {
        LOGGER.error(
            'PAYONE {0} merchantReference could not be generated because the SFCC order number is missing.',
            referenceName
        );
        return false;
    }

    if (merchantReference.length > maxLength) {
        LOGGER.error(
            'PAYONE {0} merchantReference could not be generated safely. Order number "{1}" creates a {2}-character reference with prefix "{3}", but PAYONE allows at most {4} characters.',
            referenceName,
            normalizedOrderNo,
            merchantReference.length,
            prefix,
            maxLength
        );
        return false;
    }

    return true;
}

/**
 * Validates all order-number-derived PAYONE merchant references used by the current flow.
 *
 * @param {string|null} orderNo - SFCC order number.
 * @param {boolean} includePaymentReference - Whether the flow sends the payment/order merchant reference.
 * @returns {boolean} True when the required references fit PAYONE limits.
 */
function validateOrderReferences(orderNo, includePaymentReference) {
    var isValid = true;

    isValid = isPrefixedReferenceValid('commerce case', COMMERCE_CASE_PREFIX, orderNo, MAX_COMMERCE_CASE_REFERENCE_LENGTH) && isValid;
    isValid = isPrefixedReferenceValid('checkout', CHECKOUT_PREFIX, orderNo, MAX_CHECKOUT_REFERENCE_LENGTH) && isValid;

    if (includePaymentReference !== false) {
        isValid = isPrefixedReferenceValid('payment', ORDER_PREFIX, orderNo, MAX_PAYMENT_REFERENCE_LENGTH) && isValid;
    }

    return isValid;
}

/**
 * Builds a PAYONE commerce-case reference from an SFCC order number.
 *
 * @param {string|null} orderNo - SFCC order number.
 * @returns {string|null} PAYONE commerce-case reference.
 */
function buildCommerceCaseReference(orderNo) {
    return buildPrefixedReference(COMMERCE_CASE_PREFIX, orderNo, MAX_COMMERCE_CASE_REFERENCE_LENGTH);
}

/**
 * Builds a PAYONE checkout reference from an SFCC order number.
 *
 * @param {string|null} orderNo - SFCC order number.
 * @returns {string|null} PAYONE checkout reference.
 */
function buildCheckoutReference(orderNo) {
    return buildPrefixedReference(CHECKOUT_PREFIX, orderNo, MAX_CHECKOUT_REFERENCE_LENGTH);
}

/**
 * Builds a PAYONE payment/order reference from an SFCC order number.
 *
 * @param {string|null} orderNo - SFCC order number.
 * @returns {string|null} PAYONE payment/order reference.
 */
function buildPaymentReference(orderNo) {
    return buildPrefixedReference(ORDER_PREFIX, orderNo, MAX_PAYMENT_REFERENCE_LENGTH);
}

/**
 * Builds a numeric random suffix for POS terminal-safe PAYONE references.
 *
 * @param {number} length - Required suffix length.
 * @returns {string} Numeric suffix.
 */
function buildNumericRandomSuffix(length) {
    var secureRandom = new SecureRandom();
    var suffix = '';
    var i;

    for (i = 0; i < length; i += 1) {
        suffix += String(secureRandom.nextInt(10));
    }

    return suffix;
}

/**
 * Builds a compact numeric reference.
 *
 * @param {string} prefix - Numeric reference prefix.
 * @param {number} maxLength - Reference max length.
 * @returns {string} Numeric reference.
 */
function buildNumericReference(prefix, maxLength) {
    var suffixLength = maxLength - prefix.length;

    return prefix + buildNumericRandomSuffix(suffixLength);
}

/**
 * Builds a capture action merchant reference.
 *
 * @returns {string} Numeric capture merchant reference.
 */
function buildCaptureReference() {
    return buildNumericReference(CAPTURE_PREFIX, MAX_ACTION_REFERENCE_LENGTH);
}

/**
 * Builds a refund action merchant reference.
 *
 * @returns {string} Numeric refund merchant reference.
 */
function buildRefundReference() {
    return buildNumericReference(REFUND_PREFIX, MAX_ACTION_REFERENCE_LENGTH);
}

/**
 * Builds a numeric SEPA mandate reference.
 *
 * @returns {string} Numeric SEPA mandate reference.
 */
function buildSepaMandateReference() {
    return buildNumericReference(SEPA_MANDATE_PREFIX, MAX_SEPA_MANDATE_REFERENCE_LENGTH);
}

module.exports = {
    buildCaptureReference: buildCaptureReference,
    buildCheckoutReference: buildCheckoutReference,
    buildCommerceCaseReference: buildCommerceCaseReference,
    buildPaymentReference: buildPaymentReference,
    buildRefundReference: buildRefundReference,
    buildSepaMandateReference: buildSepaMandateReference,
    validateOrderReferences: validateOrderReferences
};
