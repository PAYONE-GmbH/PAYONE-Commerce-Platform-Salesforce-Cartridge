'use strict';

var Site = require('dw/system/Site');
var payoneErrorCodeMap = require('*/cartridge/scripts/services/payoneErrorCodeMap');
var parseJson = require('*/cartridge/scripts/payone/PayoneCommonUtils').parseJson;

var DEFAULT_FALLBACK_KEY = 'payone.error.generic';

/**
 * Loads optional per-site error-code override mapping from custom preference JSON.
 *
 * @returns {Object|null} Override map keyed by error code, or null when absent/invalid.
 */
function getOverrideMapping() {
    var site = Site.getCurrent();
    var raw = site.getCustomPreferenceValue('payoneErrorCodeMappingOverride');

    if (!raw) {
        return null;
    }

    var parsed = parseJson(raw);

    if (parsed && typeof parsed === 'object') {
        return parsed;
    }

    return null;
}

/**
 * Resolves a resource key from static mappings:
 * exact `errorCode` first, then `errorTypeId` prefix family.
 *
 * @param {string|number} errorCode - PAYONE error code.
 * @param {string} errorTypeId - PAYONE error type identifier.
 * @returns {string|null} Resolved resource key, or null when no mapping exists.
 */
function getMappedKey(errorCode, errorTypeId) {
    if (!errorCode && !errorTypeId) {
        return null;
    }

    var code = errorCode ? String(errorCode) : '';
    if (code && payoneErrorCodeMap.ERROR_CODE_MAPPING[code]) {
        return payoneErrorCodeMap.ERROR_CODE_MAPPING[code];
    }

    var identifier = errorTypeId ? String(errorTypeId) : '';
    // errorTypeId values are families (e.g. "checkout-error-*"), so we intentionally do prefix matching, not exact key lookup.
    var prefixMatch = Object.keys(payoneErrorCodeMap.ERROR_ID_PREFIX_MAPPING).find(function (prefix) {
        return identifier.indexOf(prefix) === 0;
    });

    return prefixMatch ? payoneErrorCodeMap.ERROR_ID_PREFIX_MAPPING[prefixMatch] : null;
}

/**
 * Resolves the final message key with this precedence:
 * override by code -> static mappings -> default fallback.
 *
 * @param {string|number} errorCode - PAYONE error code.
 * @param {string} errorTypeId - PAYONE error type identifier.
 * @returns {string} Resource key to use for customer-facing message lookup.
 */
function getMessageKey(errorCode, errorTypeId) {
    if (!errorCode && !errorTypeId) {
        return DEFAULT_FALLBACK_KEY;
    }

    var code = errorCode ? String(errorCode) : '';
    var override = getOverrideMapping();
    if (code && override && typeof override[code] === 'string' && override[code].trim()) {
        return override[code].trim();
    }

    return getMappedKey(code, errorTypeId) || DEFAULT_FALLBACK_KEY;
}

module.exports = {
    getMessageKey: getMessageKey
};
