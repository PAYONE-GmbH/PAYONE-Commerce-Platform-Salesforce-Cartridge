'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var copyIfPresent = PayoneCommonUtils.copyIfPresent;

/**
 * PAYONE payment-method specific input model.
 *
 * @param {Object} source - Payment method specific input source.
 * @constructor
 */
function PaymentMethodSpecificInput(source) {
    var safeSource = source || {};

    this.financingPaymentMethodSpecificInput = safeSource.financingPaymentMethodSpecificInput || null;
    this.redirectPaymentMethodSpecificInput = safeSource.redirectPaymentMethodSpecificInput || null;
    this.cardPaymentMethodSpecificInput = safeSource.cardPaymentMethodSpecificInput || null;
    this.mobilePaymentMethodSpecificInput = safeSource.mobilePaymentMethodSpecificInput || null;
    this.sepaDirectDebitPaymentMethodSpecificInput = safeSource.sepaDirectDebitPaymentMethodSpecificInput || null;
    this.customerDevice = safeSource.customerDevice || null;
    this.paymentChannel = (
        this.financingPaymentMethodSpecificInput
        || this.redirectPaymentMethodSpecificInput
        || this.cardPaymentMethodSpecificInput
        || this.mobilePaymentMethodSpecificInput
        || this.sepaDirectDebitPaymentMethodSpecificInput
        || this.customerDevice
    ) ? 'ECOMMERCE' : null;
}

/**
 * Builds the PAYONE payment-method specific input payload.
 *
 * @returns {Object} PAYONE payment-method specific input payload.
 */
PaymentMethodSpecificInput.prototype.toRequest = function () {
    var payload = {};

    copyIfPresent(payload, this, 'financingPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'redirectPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'cardPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'mobilePaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'sepaDirectDebitPaymentMethodSpecificInput');
    copyIfPresent(payload, this, 'customerDevice');
    copyIfPresent(payload, this, 'paymentChannel');

    return payload;
};

module.exports = PaymentMethodSpecificInput;
