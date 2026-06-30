'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');
var Encoding = require('dw/crypto/Encoding');
var Mac = require('dw/crypto/Mac');
var Resource = require('dw/web/Resource');

var errorMapper = require('*/cartridge/scripts/services/payoneErrorMapper');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var parseJson = PayoneCommonUtils.parseJson;

var SERVICE_ID = 'payone.commerce.api';
var LOGGER = Logger.getLogger('payone', 'services');
var JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
var MERCHANT_ID_PLACEHOLDER = '{merchantId}';
var REDACTED_VALUE = '[REDACTED]';
var DEVELOPMENT_BASE_URL = 'https://api.preprod.commerce.payone.com';
var PRODUCTION_BASE_URL = 'https://api.commerce.payone.com';
var REDACT_KEYS = [
    'authorization', 'apikey', 'apisecret', 'password', 'email', 'emailaddress', 'phonenumber', 'iban', 'bic', 'bankaccountiban',
    'accountholder', 'cardholdername', 'cardnumber', 'cvv', 'cvc', 'token', 'tokenvalue', 'paymentprocessingtoken',
    'encryptedpaymentdata', 'dateofbirth', 'devicetoken', 'ipaddress'
];

/**
 * Resolves the PAYONE Commerce API base URL from the configured site environment.
 *
 * @param {*} environment - Raw site preference value.
 * @returns {string} PAYONE Commerce API base URL.
 */
function getBaseUrl(environment) {
    switch (environment) {
        case 'production':
            return PRODUCTION_BASE_URL;
        case 'development':
        default:
            return DEVELOPMENT_BASE_URL;
    }
}

/**
 * Reads PAYONE credentials and merchant configuration from site preferences.
 *
 * @returns {{environment:*, merchantId:string, apiKey:string, apiSecret:string}} Current site PAYONE preferences.
 */
function getPreferences() {
    var site = Site.getCurrent();

    return {
        merchantId: site.getCustomPreferenceValue('payoneMerchantId'),
        apiKey: site.getCustomPreferenceValue('payoneApiKey'),
        apiSecret: site.getCustomPreferenceValue('payoneApiSecret'),
        environment: site.getCustomPreferenceValue('payoneEnvironment')
    };
}

/**
 * Converts query object into sorted key/value pairs, skipping null/undefined values.
 * Stable ordering is required for deterministic signature generation.
 *
 * @param {Object} query - Query object.
 * @returns {Array<{key:string, value:string}>} Sorted query pairs.
 */
function buildQueryPairs(query) {
    if (!query) {
        return [];
    }

    var pairs = [];
    Object.keys(query).sort().forEach(function (key) {
        var value = query[key];
        if (value === null || typeof value === 'undefined') {
            return;
        }

        pairs.push({ key: key, value: String(value) });
    });

    return pairs;
}

/**
 * Replaces URL placeholders (currently merchantId) in API path templates.
 *
 * @param {string} path - Path template that may include placeholders.
 * @param {{merchantId:string}} prefs - Preference object.
 * @returns {string} Resolved API path.
 */
function resolvePathPlaceholders(path, prefs) {
    var merchantId = (prefs && prefs.merchantId) || '';
    return String(path || '').replace(new RegExp(MERCHANT_ID_PLACEHOLDER, 'g'), merchantId);
}

/**
 * Builds encoded query string for outgoing HTTP URL.
 *
 * @param {Object} query - Query object.
 * @returns {string} Encoded query string including leading `?`, or empty string.
 */
function buildQueryStringEncoded(query) {
    if (!query) {
        return '';
    }

    var parts = [];
    buildQueryPairs(query).forEach(function (pair) {
        parts.push(encodeURIComponent(pair.key) + '=' + encodeURIComponent(pair.value));
    });

    return parts.length ? '?' + parts.join('&') : '';
}

/**
 * Combines service base URL, path and encoded query parameters.
 *
 * @param {string} baseUrl - PAYONE Commerce API base URL.
 * @param {string} path - Resolved API path.
 * @param {Object} query - Query object.
 * @returns {string} Final request URL.
 */
function buildUrl(baseUrl, path, query) {
    var normalizedBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    var urlPath = path || '';
    var url = normalizedBase + urlPath + buildQueryStringEncoded(query);

    return url;
}

/**
 * Builds non-encoded query string used by PAYONE signature resource.
 *
 * @param {Object} query - Query object.
 * @returns {string} Decoded query string including leading `?`, or empty string.
 */
function buildQueryStringDecoded(query) {
    if (!query) {
        return '';
    }

    var parts = [];
    buildQueryPairs(query).forEach(function (pair) {
        parts.push(pair.key + '=' + pair.value);
    });

    return parts.length ? '?' + parts.join('&') : '';
}

/**
 * Builds resource component used for HMAC signature.
 *
 * @param {string} path - Resolved API path.
 * @param {Object} query - Query object.
 * @returns {string} Signature resource string.
 */
function buildSignatureResource(path, query) {
    return (path || '') + buildQueryStringDecoded(query);
}

/**
 * Creates canonical signature input string for PAYONE HMAC auth.
 *
 * @param {string} method - HTTP method.
 * @param {string} contentType - Request content type (when applicable).
 * @param {string} date - RFC date header value.
 * @param {string} resource - Signature resource.
 * @returns {string} Canonical signature payload.
 */
function buildSignature(method, contentType, date, resource) {
    return method + '\n' +
        (contentType || '') + '\n' +
        date + '\n' +
        resource + '\n';
}

/**
 * Builds PAYONE authorization header using HMAC-SHA256 signature.
 *
 * @param {{apiKey:string, apiSecret:string}} prefs - API credential preferences.
 * @param {string} method - HTTP method.
 * @param {string} contentType - Request content type.
 * @param {string} date - Date header value.
 * @param {string} resource - Signature resource.
 * @returns {string|null} Authorization header value, or null when credentials are missing.
 */
function buildAuthHeader(prefs, method, contentType, date, resource) {
    if (!prefs || !prefs.apiKey || !prefs.apiSecret) {
        return null;
    }

    var stringToHash = buildSignature(method, contentType, date, resource);
    var mac = new Mac(Mac.HMAC_SHA_256);
    var digest = mac.digest(stringToHash, prefs.apiSecret);
    var signature = Encoding.toBase64(digest);

    return 'GCS v1HMAC:' + prefs.apiKey + ':' + signature;
}

/**
 * Recursively redacts sensitive fields from an object tree for safe logging.
 *
 * @param {*} value - Any value to sanitize.
 * @returns {*} Sanitized clone with sensitive keys replaced.
 */
function redactSensitiveFields(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        var sanitizedArray = [];
        value.forEach(function (item) {
            sanitizedArray.push(redactSensitiveFields(item));
        });
        return sanitizedArray;
    }

    var sanitized = {};
    Object.keys(value).forEach(function (key) {
        if (key && REDACT_KEYS.indexOf(String(key).toLowerCase()) > -1) {
            sanitized[key] = REDACTED_VALUE;
            return;
        }

        sanitized[key] = redactSensitiveFields(value[key]);
    });

    return sanitized;
}

/**
 * Sanitizes outgoing log messages by masking auth headers and sensitive JSON fields.
 *
 * @param {*} value - Raw log message.
 * @returns {*} Sanitized log-safe value.
 */
function sanitizeLogMessage(value) {
    if (!value) {
        return value;
    }

    // Always mask Authorization in plain text first (covers non-JSON logs too).
    var text = String(value)
        .replace(/(authorization:\s*)([^\r\n]+)/gi, '$1' + REDACTED_VALUE);

    // Then try JSON parsing; if it succeeds, redact nested sensitive keys.
    var parsed = parseJson(text);
    if (parsed) {
        return JSON.stringify(redactSensitiveFields(parsed));
    }

    return text;
}

/**
 * Creates the SFCC service wrapper with request/response adapters and log filtering.
 *
 * @returns {dw.svc.Service} Configured local service instance.
 */
function createService() {
    return LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, requestData) {
            var prefs = getPreferences();
            var resolvedPath = resolvePathPlaceholders(requestData.path, prefs);
            var url = buildUrl(getBaseUrl(prefs.environment), resolvedPath, requestData.query);

            svc.setURL(url);
            var method = (requestData.method || 'GET').toUpperCase();
            svc.setRequestMethod(method);
            svc.addHeader('Accept', 'application/json');

            var hasBody = requestData.body !== null && typeof requestData.body !== 'undefined';
            var needsContentType = method === 'POST' || method === 'PATCH' || method === 'PUT';
            if (needsContentType) {
                svc.addHeader('Content-Type', JSON_CONTENT_TYPE);
            }

            var dateHeader = new Date().toUTCString();
            svc.addHeader('Date', dateHeader);

            var signatureResource = buildSignatureResource(resolvedPath, requestData.query);
            var signatureContentType = needsContentType ? JSON_CONTENT_TYPE : '';
            var authHeader = buildAuthHeader(prefs, method, signatureContentType, dateHeader, signatureResource);
            if (authHeader) {
                svc.addHeader('Authorization', authHeader);
            }

            if (hasBody) {
                return JSON.stringify(requestData.body);
            }

            return null;
        },
        parseResponse: function (svc, client) {
            var responseText = client.text;
            var data = parseJson(responseText);

            return {
                statusCode: client.statusCode,
                data: data,
                raw: responseText
            };
        },
        filterLogMessage: function (msg) {
            return sanitizeLogMessage(msg);
        }
    });
}

/**
 * Extracts normalized PAYONE errors from failed service result payload.
 *
 * @param {Object} result - SFCC service call result.
 * @returns {Array<Object>} Normalized list of PAYONE error details.
 */
function extractErrorsFromResult(result) {
    var errors = [];
    if (!result) {
        return errors;
    }

    var payload = parseJson(result.errorMessage);
    if (!payload || !Array.isArray(payload.errors)) {
        return errors;
    }

    payload.errors.forEach(function (err) {
        if (!err) {
            return;
        }
        errors.push({
            code: err.errorCode || 'UNKNOWN',
            errorTypeId: err.id || null,
            errorTrackingId: payload.errorId || null,
            category: err.category || null,
            property: err.propertyName || null,
            message: err.message || ''
        });
    });

    return errors;
}

/**
 * Derives HTTP status code from service result object.
 *
 * @param {Object} result - SFCC service call result.
 * @returns {number|null} Status code when available (transport error code or HTTP status).
 */
function getStatusCodeFromResult(result) {
    if (!result) {
        return null;
    }

    if (typeof result.error === 'number' && result.error > 0) {
        return Number(result.error);
    }

    if (result.object && result.object.statusCode) {
        return Number(result.object.statusCode);
    }

    return null;
}

/**
 * Resolves a localized user-facing message from normalized PAYONE errors.
 *
 * @param {Array<Object>} errors - Normalized PAYONE errors.
 * @returns {string} Localized user message.
 */
function buildUserMessage(errors) {
    var genericMessage = Resource.msg('payone.error.generic', 'payoneError', null);

    if (!errors || !errors.length) {
        return genericMessage;
    }

    var primary = errors[0];
    var key = errorMapper.getMessageKey(primary.code, primary.errorTypeId);
    return Resource.msg(key, 'payoneError', genericMessage);
}

/**
 * Determines whether a failed service result should be retried.
 * Retries are disabled for 4xx responses and enabled for service-unavailable/5xx failures.
 *
 * @param {Object} result - SFCC service call result.
 * @returns {boolean} True when retry is allowed.
 */
function shouldRetry(result) {
    if (!result) {
        return true;
    }

    var statusCode = getStatusCodeFromResult(result);
    if (statusCode >= 400 && statusCode <= 499) {
        return false;
    }

    if (result.status === 'SERVICE_UNAVAILABLE') {
        return true;
    }

    if (statusCode >= 500 && statusCode <= 599) {
        return true;
    }

    return false;
}

/**
 * Executes PAYONE API call with retry logic and normalized response contract.
 *
 * @param {Object} requestData - Request contract (`method`, `path`, optional `body`, optional `query`).
 * @returns {Object} Normalized response object for controllers/services.
 */
function call(requestData) {
    var MAX_RETRY_ATTEMPTS = 3;
    var attempt = 0;
    var maxTotalAttempts = MAX_RETRY_ATTEMPTS + 1; // initial try + retries
    var result;
    var service;

    while (attempt < maxTotalAttempts) {
        attempt += 1;
        service = createService();
        result = service.call(requestData);

        if (result.ok) {
            break;
        }

        if (!shouldRetry(result) || attempt >= maxTotalAttempts) {
            break;
        }

        LOGGER.info(
            'Retrying PAYONE API call (attempt {0}/{1}) due to status={2}, httpStatus={3}',
            attempt + 1,
            maxTotalAttempts,
            result.status,
            getStatusCodeFromResult(result) || '-'
        );
    }

    var normalizedResponse = {
        ok: result.ok,
        status: result.status,
        statusCode: getStatusCodeFromResult(result),
        data: result.object ? result.object.data : null,
        raw: result.object ? result.object.raw : null,
        retryAttempts: Math.max(0, attempt - 1),
        totalAttempts: attempt
    };

    if (!normalizedResponse.ok) {
        var errors = extractErrorsFromResult(result);
        normalizedResponse.errors = errors;
        normalizedResponse.userMessage = buildUserMessage(errors);

        if (errors.length) {
            errors.forEach(function (err) {
                LOGGER.error(
                    'Payone API error code={0}, errorTypeId={1}, errorTrackingId={2}, category={3}, property={4}, message={5}',
                    err.code,
                    err.errorTypeId || '-',
                    err.errorTrackingId || '-',
                    err.category || '-',
                    err.property || '-',
                    err.message || '-'
                );
            });
        } else if (result.errorMessage) {
            LOGGER.error('Payone API error: {0}', result.errorMessage);
        } else {
            LOGGER.error('Payone API call failed with status={0}, error={1}', result.status, result.error);
        }
    }

    return normalizedResponse;
}

module.exports = {
    call: call
};
