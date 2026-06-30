'use strict';

var Status = require('dw/system/Status');

/**
 * Called after OCAPI returns the basket payment methods response.
 *
 * @param {dw.ocapi.shop.basket.PaymentMethodResult} paymentMethodResult - Response object to modify.
 * @returns {dw.system.Status} Hook execution status.
 */
module.exports.modifyGETResponse = function (paymentMethodResult) {
    if (request.clientId && request.clientId === 'dw.csc') {
        var paymentProcesor = 'PAYONE_COMMERCE';
        var applicablePaymentMethods = paymentMethodResult.applicablePaymentMethods;

        if (applicablePaymentMethods) {
            var paymentMethods = Array.isArray(applicablePaymentMethods)
                ? applicablePaymentMethods
                : applicablePaymentMethods.toArray();

            paymentMethodResult.applicablePaymentMethods = paymentMethods.filter(function (paymentMethod) {
                return paymentMethod.paymentProcessorId !== paymentProcesor;
            });
        }
    }
    return new Status(Status.OK);
};
