'use strict';

var Site = require('dw/system/Site');
var Mac = require('dw/crypto/Mac');
var Encoding = require('dw/crypto/Encoding');
var Bytes = require('dw/util/Bytes');
var Transaction = require('dw/system/Transaction');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');

var WEBHOOK_CO_TYPE = 'PayoneWebhookEvent';

/**
* Computes a base64-encoded HMAC-SHA256 signature for the given raw body using the provided secret.
* @param {string} rawBody - The raw request body to be signed.
* @param {string} secret - The secret key used for HMAC computation.
* @returns {string} The base64-encoded HMAC-SHA256 signature.
*/
function computeSignature(rawBody, secret) {
    var mac = new Mac(Mac.HMAC_SHA_256);
    var digest = mac.digest(new Bytes(rawBody || '', 'UTF-8'), new Bytes(secret || '', 'UTF-8'));

    return Encoding.toBase64(digest);
}

/**
* Compares two strings in a timing-safe manner to prevent timing attacks.
* Ensures that the comparison takes the same amount of time regardless of where the first difference occurs.
*
* @param {string} left - The first string to compare.
* @param {string} right - The second string to compare.
* @returns {boolean} True if both strings are equal, false otherwise.
*/
function timingSafeEqual(left, right) {
    var a = (left || '') + '';
    var b = (right || '') + '';
    var maxLen = Math.max(a.length, b.length);
    var mismatch = a.length ^ b.length; // eslint-disable-line no-bitwise
    var i;
    var aCode;
    var bCode;

    for (i = 0; i < maxLen; i += 1) {
        aCode = i < a.length ? a.charCodeAt(i) : 0;
        bCode = i < b.length ? b.charCodeAt(i) : 0;
        mismatch |= (aCode ^ bCode); // eslint-disable-line no-bitwise
    }

    return mismatch === 0;
}

/**
* Verifies the signature of an incoming webhook request using the configured Payone API secret and key ID.
*
* @param {string} rawBody - The raw request body received from the webhook.
* @param {string} signatureHeader - The signature provided in the webhook request headers.
* @param {string} keyIdHeader - The key ID provided in the webhook request headers.
* @returns {Object} An object indicating the verification result:
*   - {boolean} ok - True if the signature is valid, false otherwise.
*   - {string} code - Error code if verification fails ('MISSING_CONFIGURATION', 'KEYID_MISMATCH', or 'SIGNATURE_MISMATCH').
*   - {string} message - A human-readable message describing the result.
*/
function verifySignature(rawBody, signatureHeader, keyIdHeader) {
    var currentSite = Site.getCurrent();
    var configuredSecret = currentSite.getCustomPreferenceValue('payoneApiSecret');
    var configuredKeyId = currentSite.getCustomPreferenceValue('payoneApiKey');
    var computedSignature;

    if (!configuredSecret) {
        return {
            ok: false,
            code: 'MISSING_CONFIGURATION',
            message: 'Missing payoneApiSecret site preference.'
        };
    }

    if (configuredKeyId && keyIdHeader && (configuredKeyId + '') !== (keyIdHeader + '')) {
        return {
            ok: false,
            code: 'KEYID_MISMATCH',
            message: 'Key ID does not match configured payoneApiKey.'
        };
    }

    computedSignature = computeSignature(rawBody, configuredSecret + '');

    return {
        ok: timingSafeEqual(computedSignature, signatureHeader),
        code: 'SIGNATURE_MISMATCH',
        message: 'Invalid webhook signature.'
    };
}

/**
* Queues a webhook event by creating a custom object if it does not already exist.
* Prevents duplicate processing by checking for an existing custom object with the event ID.
*
* @param {Object} webhookEvent - The webhook event object containing event details (must have an 'id' property).
* @param {string} rawBody - The raw request body of the webhook event.
* @returns {Object} An object indicating the result of the queue operation:
*   - {boolean} queued - True if the event was queued, false otherwise.
*   - {boolean} duplicate - True if the event was already queued (duplicate), false otherwise.
*   - {string} eventId - The unique identifier of the webhook event.
*/
function queueWebhookEvent(webhookEvent, rawBody) {
    var webhookEventId = webhookEvent.id + '';
    var alreadyExists = CustomObjectMgr.getCustomObject(WEBHOOK_CO_TYPE, webhookEventId);
    var queueResult = {
        queued: true,
        duplicate: false,
        eventId: webhookEventId
    };

    if (alreadyExists) {
        return {
            queued: false,
            duplicate: true,
            eventId: webhookEventId
        };
    }

    try {
        var rawBodyParsed = JSON.parse(rawBody);
        if (!rawBodyParsed) {
            return {
                error: true,
                message: 'Invalid webhook payload',
                eventId: webhookEventId
            };
        }

        var merchantReference =
            rawBodyParsed.payment &&
            rawBodyParsed.payment.paymentOutput &&
            rawBodyParsed.payment.paymentOutput.references &&
            rawBodyParsed.payment.paymentOutput.references.merchantReference || '';
        if (!merchantReference) {
            return {
                error: true,
                message: 'Missing merchant reference',
                eventId: webhookEventId
            };
        }

        Transaction.wrap(function () {
            var customObject = CustomObjectMgr.createCustomObject(WEBHOOK_CO_TYPE, webhookEventId);

            customObject.custom.type = webhookEvent.type || '';
            customObject.custom.apiVersion = webhookEvent.apiVersion || '';
            customObject.custom.merchantId = webhookEvent.merchantId || '';
            customObject.custom.eventCreated = webhookEvent.created || '';
            customObject.custom.merchantReference = merchantReference || '';
            customObject.custom.payload = rawBody || '';
            customObject.custom.processingStatus = 'PENDING';
            customObject.custom.processingAttempts = 0;
        });
    } catch (e) {
        queueResult.queued = false;
        queueResult.duplicate = true;
    }

    return queueResult;
}

module.exports = {
    WEBHOOK_CO_TYPE: WEBHOOK_CO_TYPE,
    verifySignature: verifySignature,
    queueWebhookEvent: queueWebhookEvent
};
