'use strict';

var payoneService = require('*/cartridge/scripts/services/payoneService');

/**
 * Builds the checkout base path for a commerce case.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {string} checkoutId - PAYONE checkout UUID.
 * @returns {string} API path with merchant placeholder.
 */
function getBasePath(commerceCaseId, checkoutId) {
    return '/v1/{merchantId}/commerce-cases/' + commerceCaseId + '/checkouts/' + checkoutId;
}

/**
 * Completes an existing checkout order.
 *
 * @param {Object} params - Request wrapper with IDs and optional complete body.
 * @returns {Object} Normalized PAYONE service response.
 */
function completeOrder(params) {
    var requestData = params || {};

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) + '/complete-order',
        body: typeof requestData.body !== 'undefined' ? requestData.body : null,
        query: requestData.query || null
    });
}

/**
 * Cancels an existing checkout order and its associated payment.
 *
 * @param {Object} params - Request wrapper with IDs and optional cancel body.
 * @returns {Object} Normalized PAYONE service response.
 */
function cancel(params) {
    var requestData = params || {};

    return payoneService.call({
        method: 'POST',
        path: getBasePath(requestData.commerceCaseId, requestData.checkoutId) + '/cancel',
        body: typeof requestData.body !== 'undefined' ? requestData.body : null,
        query: requestData.query || null
    });
}

module.exports = {
    cancel: cancel,
    completeOrder: completeOrder
};
