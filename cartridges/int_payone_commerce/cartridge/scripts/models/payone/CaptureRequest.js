'use strict';

var DeliveryInformation = require('*/cartridge/scripts/models/payone/DeliveryInformation');
var PaymentReferences = require('*/cartridge/scripts/models/payone/PaymentReferences');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;
var toInt = PayoneCommonUtils.toInt;

/**
 * PAYONE capture request model.
 *
 * @param {Object} source - Source request data.
 * @constructor
 */
function CaptureRequest(source) {
    var safeSource = source || {};
    var amount = toInt(safeSource.amount);

    this.amount = amount !== null && amount > 0 ? amount : null;
    this.isFinal = typeof safeSource.isFinal === 'boolean' ? safeSource.isFinal : null;
    this.cancellationReason = trimString(safeSource.cancellationReason);
    this.references = new PaymentReferences(safeSource.references || {});
    this.delivery = safeSource.delivery ? new DeliveryInformation(safeSource.delivery) : null;
}

/**
 * Builds the PAYONE capture request payload.
 *
 * @returns {Object} PAYONE capture request payload.
 */
CaptureRequest.prototype.toRequest = function () {
    var payload = {};
    var references = this.references.toRequest();
    var delivery = this.delivery ? this.delivery.toRequest() : null;

    if (this.amount !== null) {
        payload.amount = this.amount;
    }
    if (this.isFinal !== null) {
        payload.isFinal = this.isFinal;
    }
    if (this.cancellationReason) {
        payload.cancellationReason = this.cancellationReason;
    }
    if (references.merchantReference) {
        payload.references = references;
    }
    if (delivery && delivery.items && delivery.items.length) {
        payload.delivery = delivery;
    }

    return payload;
};

module.exports = CaptureRequest;
