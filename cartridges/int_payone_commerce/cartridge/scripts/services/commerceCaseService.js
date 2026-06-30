'use strict';

var payoneService = require('*/cartridge/scripts/services/payoneService');

/**
 * Builds the commerce-case base path, optionally scoped to a specific commerce case.
 *
 * @param {string} [commerceCaseId] - Optional PAYONE commerce case UUID.
 * @returns {string} API path with merchant placeholder.
 */
function getBasePath(commerceCaseId) {
    var path = '/v1/{merchantId}/commerce-cases';
    return commerceCaseId ? path + '/' + commerceCaseId : path;
}

/**
 * Normalizes incoming request data into the service call contract.
 *
 * @param {Object} [params] - Optional payload containing body/query fields.
 * @returns {Object} Safe request parts (`body`, `query`).
 */
function getRequestParts(params) {
    var requestData = params || {};
    return {
        body: typeof requestData.body !== 'undefined' ? requestData.body : null,
        query: requestData.query || null
    };
}

/**
 * Creates a new commerce case.
 *
 * @param {Object} [params] - Request wrapper with `body` and optional `query`.
 * @returns {Object} Normalized PAYONE service response.
 */
function create(params) {
    var requestData = getRequestParts(params);
    return payoneService.call({
        method: 'POST',
        path: getBasePath(),
        body: requestData.body,
        query: requestData.query
    });
}

/**
 * Searches commerce cases for the configured merchant.
 *
 * @param {Object} [params] - Request wrapper with optional `query` filters.
 * @returns {Object} Normalized PAYONE service response.
 */
function search(params) {
    var requestData = getRequestParts(params);
    return payoneService.call({
        method: 'GET',
        path: getBasePath(),
        query: requestData.query
    });
}

/**
 * Gets one commerce case by ID.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {Object} [params] - Request wrapper with optional `query`.
 * @returns {Object} Normalized PAYONE service response.
 */
function get(commerceCaseId, params) {
    var requestData = getRequestParts(params);
    return payoneService.call({
        method: 'GET',
        path: getBasePath(commerceCaseId),
        query: requestData.query
    });
}

/**
 * Updates the customer object of an existing commerce case.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {Object} [params] - Request wrapper with `body` patch payload and optional `query`.
 * @returns {Object} Normalized PAYONE service response.
 */
function update(commerceCaseId, params) {
    var requestData = getRequestParts(params);
    return payoneService.call({
        method: 'PATCH',
        path: getBasePath(commerceCaseId),
        body: requestData.body,
        query: requestData.query
    });
}

module.exports = {
    create: create,
    search: search,
    get: get,
    update: update
};
