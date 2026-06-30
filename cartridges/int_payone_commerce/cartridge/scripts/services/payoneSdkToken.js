'use strict';

var payoneService = require('*/cartridge/scripts/services/payoneService');

/**
* Extracts and returns the body and query parts from the provided parameters object.
*
* @param {Object} params - The parameters object containing request data.
* @param {*} [params.body] - The body of the request, if present.
* @param {*} [params.query] - The query parameters of the request, if present.
* @returns {Object} An object with 'body' and 'query' properties, each set to their respective values or null if not provided.
*/
function getRequestParts(params) {
    var requestData = params || {};
    return {
        body: typeof requestData.body !== 'undefined' ? requestData.body : null,
        query: requestData.query || null
    };
}

/**
* Sends a POST request to the Payone service to retrieve an authentication token.
* @param {Object} params - Parameters required to build the authentication token request.
* @returns {dw.svc.Result} The result of the Payone service call containing the authentication token response.
*/
function get(params) {
    var requestData = getRequestParts(params);
    return payoneService.call({
        method: 'POST',
        path: '/v1/{merchantId}/authentication-tokens',
        query: requestData.query
    });
}


module.exports = {
    get: get
};
