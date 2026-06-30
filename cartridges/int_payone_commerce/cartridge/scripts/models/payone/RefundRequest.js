'use strict';

var PaymentReferences = require('*/cartridge/scripts/models/payone/PaymentReferences');
var ReturnInformation = require('*/cartridge/scripts/models/payone/ReturnInformation');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var trimString = PayoneCommonUtils.trimString;
var toInt = PayoneCommonUtils.toInt;

/**
 * Normalizes PAYONE refund amount data into the expected amount-of-money shape.
 *
 * @param {Object} source - Raw amount-of-money source object.
 * @returns {Object|null} Normalized amount-of-money payload or null when invalid.
 */
function normalizeAmountOfMoney(source) {
    var safeSource = source || {};
    var amount = toInt(safeSource.amount);
    var currencyCode = trimString(safeSource.currencyCode);

    if (amount === null || amount <= 0 || !currencyCode) {
        return null;
    }

    return {
        amount: amount,
        currencyCode: currencyCode.toUpperCase()
    };
}

/**
 * PAYONE refund request model.
 *
 * @param {Object} source - Source refund data.
 * @constructor
 */
function RefundRequest(source) {
    var safeSource = source || {};

    this.amountOfMoney = normalizeAmountOfMoney(safeSource.amountOfMoney);
    this.references = new PaymentReferences(safeSource.references || {});
    // eslint-disable-next-line dot-notation
    this.returnInformation = safeSource['return'] ? new ReturnInformation(safeSource['return']) : null;
}

/**
 * Builds the PAYONE refund request payload.
 *
 * @returns {Object} PAYONE refund request payload.
 */
RefundRequest.prototype.toRequest = function () {
    var payload = {};
    var references = this.references.toRequest();
    var returnInformation = this.returnInformation ? this.returnInformation.toRequest() : null;

    if (this.amountOfMoney) {
        payload.amountOfMoney = this.amountOfMoney;
    }
    if (references.merchantReference) {
        payload.references = references;
    }
    if (returnInformation && (returnInformation.returnReason || (returnInformation.items && returnInformation.items.length))) {
        // eslint-disable-next-line dot-notation
        payload['return'] = returnInformation;
    }

    return payload;
};

module.exports = RefundRequest;
