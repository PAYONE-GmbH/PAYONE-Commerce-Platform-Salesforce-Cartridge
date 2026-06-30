'use strict';

var Logger = require('dw/system/Logger');
var Transaction = require('dw/system/Transaction');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var LOGGER = Logger.getLogger('payone', 'checkout');

/**
 * Saves PAYONE identifiers and statuses on an SFCC payment transaction.
 *
 * @param {dw.order.PaymentTransaction|Object} paymentTransaction - SFCC payment transaction.
 * @param {Object} identifierData - PAYONE identifier bundle to save.
 * @returns {boolean} True when the identifiers were saved.
 */
function saveIdentifiersOnPaymentTransaction(paymentTransaction, identifierData) {
    if (!paymentTransaction || !identifierData) {
        return false;
    }

    try {
        Transaction.wrap(function () {
            paymentTransaction.custom.payoneCommerceCaseId = identifierData.commerceCaseId || null;
            paymentTransaction.custom.payoneMerchantReference = identifierData.merchantReference || null;
            paymentTransaction.custom.payoneCheckoutId = identifierData.checkoutId || null;
            paymentTransaction.custom.payonePaymentExecutionId = identifierData.paymentExecutionId || null;
            paymentTransaction.custom.payoneCheckoutPaymentStatus = identifierData.checkoutPaymentStatus || null;
            paymentTransaction.custom.payoneLatestPaymentEventStatus = identifierData.latestPaymentEventStatus || null;
            paymentTransaction.custom.payoneRedirectUrl = identifierData.redirectUrl || null;
        });
    } catch (e) {
        LOGGER.error(
            'PAYONE identifiers could not be saved on payment transaction. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
        return false;
    }

    return true;
}

/**
 * Saves the SFCC payment processor, transaction id, and PAYONE identifiers atomically.
 *
 * @param {dw.order.PaymentTransaction|Object} paymentTransaction - SFCC payment transaction.
 * @param {dw.order.PaymentProcessor|Object} paymentProcessor - SFCC payment processor.
 * @param {string} transactionId - Transaction identifier to save.
 * @param {Object} identifierData - PAYONE identifier bundle to save.
 * @returns {boolean} True when the authorization data was saved.
 */
function saveAuthorizationOnPaymentTransaction(paymentTransaction, paymentProcessor, transactionId, identifierData) {
    if (!paymentTransaction || !paymentProcessor || !transactionId || !identifierData) {
        return false;
    }

    try {
        Transaction.wrap(function () {
            paymentTransaction.setTransactionID(transactionId);
            paymentTransaction.setPaymentProcessor(paymentProcessor);
            paymentTransaction.custom.payoneCommerceCaseId = identifierData.commerceCaseId || null;
            paymentTransaction.custom.payoneMerchantReference = identifierData.merchantReference || null;
            paymentTransaction.custom.payoneCheckoutId = identifierData.checkoutId || null;
            paymentTransaction.custom.payonePaymentExecutionId = identifierData.paymentExecutionId || null;
            paymentTransaction.custom.payoneCheckoutPaymentStatus = identifierData.checkoutPaymentStatus || null;
            paymentTransaction.custom.payoneLatestPaymentEventStatus = identifierData.latestPaymentEventStatus || null;
            paymentTransaction.custom.payoneRedirectUrl = identifierData.redirectUrl || null;
        });
    } catch (e) {
        LOGGER.error(
            'PAYONE authorization data could not be saved on payment transaction. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
        return false;
    }

    return true;
}

/**
 * Extracts the payment execution ID from supported PAYONE checkout response variants.
 *
 * @param {Object} checkout - PAYONE checkout payload.
 * @returns {string|null} Payment execution id.
 */
function getPaymentExecutionIdFromCheckout(checkout) {
    var paymentExecutions = checkout && checkout.paymentExecutions;

    if (checkout && checkout.paymentExecution && checkout.paymentExecution.paymentExecutionId) {
        return checkout.paymentExecution.paymentExecutionId;
    }

    if (paymentExecutions && paymentExecutions.length && paymentExecutions[0] && paymentExecutions[0].paymentExecutionId) {
        return paymentExecutions[0].paymentExecutionId;
    }

    if (checkout && checkout.paymentResponse && checkout.paymentResponse.paymentExecutionId) {
        return checkout.paymentResponse.paymentExecutionId;
    }

    return null;
}

/**
 * Extracts PAYONE identifiers from a PAYONE commerce-case create response.
 *
 * @param {Object} createResult - Normalized PAYONE create response.
 * @returns {{commerceCaseId:string, merchantReference:(string|null), checkoutId:string, paymentExecutionId:string, checkoutPaymentStatus:(string|null), latestPaymentEventStatus:(string|null), redirectUrl:(string|null)}|null} Identifier bundle.
 */
function extractIdentifiersFromCreateResult(createResult) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);
    var paymentExecutionId = getPaymentExecutionIdFromCheckout(checkout);

    if (!(createResult && createResult.data && createResult.data.commerceCaseId && checkout && checkout.checkoutId && paymentExecutionId)) {
        return null;
    }

    return {
        commerceCaseId: createResult.data.commerceCaseId,
        merchantReference: checkout && checkout.references ? checkout.references.merchantReference || null : null,
        checkoutId: checkout.checkoutId,
        paymentExecutionId: paymentExecutionId,
        checkoutPaymentStatus: payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout),
        latestPaymentEventStatus: payoneCheckoutStateHelper.getLatestPaymentEventStatus(checkout, paymentExecutionId),
        redirectUrl: payoneCheckoutStateHelper.getRedirectUrl(checkout)
    };
}

/**
 * Saves PAYONE identifiers from a PAYONE commerce-case create response onto the order payment transaction.
 *
 * @param {dw.order.OrderPaymentInstrument|Object} paymentInstrument - SFCC payment instrument.
 * @param {Object} createResult - Normalized PAYONE create response.
 * @returns {Object|null} Saved identifier bundle.
 */
function saveIdentifiersFromCreateResult(paymentInstrument, createResult) {
    var identifierData = extractIdentifiersFromCreateResult(createResult);
    var saved;

    saved = saveIdentifiersOnPaymentTransaction(paymentInstrument && paymentInstrument.paymentTransaction, identifierData);

    return saved ? identifierData : null;
}

module.exports = {
    extractIdentifiersFromCreateResult: extractIdentifiersFromCreateResult,
    saveAuthorizationOnPaymentTransaction: saveAuthorizationOnPaymentTransaction,
    saveIdentifiersOnPaymentTransaction: saveIdentifiersOnPaymentTransaction,
    saveIdentifiersFromCreateResult: saveIdentifiersFromCreateResult
};
