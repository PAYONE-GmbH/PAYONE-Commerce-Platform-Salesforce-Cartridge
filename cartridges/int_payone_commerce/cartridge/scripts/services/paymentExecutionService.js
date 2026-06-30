'use strict';

var payoneService = require('*/cartridge/scripts/services/payoneService');

/**
 * Builds the payment-execution base path for a checkout.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {string} checkoutId - PAYONE checkout UUID.
 * @returns {string} API path with merchant placeholder.
 */
function getBasePath(commerceCaseId, checkoutId) {
    return '/v1/{merchantId}/commerce-cases/' + commerceCaseId +
        '/checkouts/' + checkoutId + '/payment-executions';
}

/**
 * Normalizes incoming request data into IDs plus body/query parts.
 *
 * @param {Object} [params] - Request wrapper for payment-execution actions.
 * @returns {Object} Safe request parts (`commerceCaseId`, `checkoutId`, `paymentExecutionId`, `body`, `query`).
 */
function getRequestParts(params) {
    var requestData = params || {};
    return {
        commerceCaseId: requestData.commerceCaseId,
        checkoutId: requestData.checkoutId,
        paymentExecutionId: requestData.paymentExecutionId,
        body: typeof requestData.body !== 'undefined' ? requestData.body : null,
        query: requestData.query || null
    };
}

/**
 * Completes an existing payment execution.
 *
 * @param {Object} params - Request wrapper with IDs and completion body.
 * @returns {Object} Normalized PAYONE service response.
 */
function complete(params) {
    var requestData = getRequestParts(params);

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) +
            '/' + requestData.paymentExecutionId + '/complete',
        body: requestData.body,
        query: requestData.query
    });
}

/**
 * Captures funds for an existing payment execution.
 *
 * @param {Object} params - Request wrapper with IDs and optional capture body.
 * @returns {Object} Normalized PAYONE service response.
 */
function capture(params) {
    var requestData = getRequestParts(params);

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) +
            '/' + requestData.paymentExecutionId + '/capture',
        body: requestData.body,
        query: requestData.query
    });
}

/**
 * Cancels an existing payment execution.
 *
 * @param {Object} params - Request wrapper with IDs and optional cancel body.
 * @returns {Object} Normalized PAYONE service response.
 */
function cancel(params) {
    var requestData = getRequestParts(params);

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) +
            '/' + requestData.paymentExecutionId + '/cancel',
        body: requestData.body,
        query: requestData.query
    });
}

/**
 * Refunds an existing payment execution.
 *
 * @param {Object} params - Request wrapper with IDs and optional refund body.
 * @returns {Object} Normalized PAYONE service response.
 */
function refund(params) {
    var requestData = getRequestParts(params);

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) +
            '/' + requestData.paymentExecutionId + '/refund',
        body: requestData.body,
        query: requestData.query
    });
}

module.exports = {
    complete: complete,
    capture: capture,
    cancel: cancel,
    refund: refund
};
