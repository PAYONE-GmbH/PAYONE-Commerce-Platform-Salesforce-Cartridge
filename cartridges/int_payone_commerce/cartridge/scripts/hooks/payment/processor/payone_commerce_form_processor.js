'use strict';

var server = require('server');
var Resource = require('dw/web/Resource');
var BasketMgr = require('dw/order/BasketMgr');

var payoneCommerceCheckoutHelper = require('*/cartridge/scripts/helpers/payoneCommerceCheckoutHelper');
var payonePaymentMethodSpecificInputBuilder = require('*/cartridge/scripts/payone/payonePaymentMethodSpecificInputBuilder');
var payoneCheckoutContextCleanupHelper = require('*/cartridge/scripts/payone/payoneCheckoutContextCleanupHelper');
var payoneCheckoutRefreshHelper = require('*/cartridge/scripts/payone/payoneCheckoutRefreshHelper');
var payonePayPalHelper = require('*/cartridge/scripts/payone/payonePayPalHelper');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');
var payoneSecureInstallmentCheckoutHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentCheckoutHelper');
var FORM_VALIDATION_METHODS = {
    PAYONE_COMMERCE_CARD: true,
    PAYONE_COMMERCE_SEPA: true,
    PAYONE_COMMERCE_SECURE_INVOICE: true,
    PAYONE_COMMERCE_SECURE_INSTALLMENT: true,
    PAYONE_COMMERCE_SECURE_DIRECT_DEBIT: true
};

/**
 * Recursively extracts invalid SFCC form-field errors.
 *
 * @param {Object|null} form - SFCC form or form group.
 * @returns {Object} Flat map of html field names to error messages.
 */
function getFormErrors(form) {
    var results = {};

    if (form === null || typeof form === 'undefined') {
        return {};
    }

    Object.keys(form).forEach(function (key) {
        if (form[key] && Object.prototype.hasOwnProperty.call(form[key], 'formType')) {
            if (form[key].formType === 'formField' && !form[key].valid) {
                results[form[key].htmlName] = form[key].error;
            }

            if (form[key].formType === 'formGroup') {
                var innerFormResult = getFormErrors(form[key]);

                Object.keys(innerFormResult).forEach(function (innerKey) {
                    results[innerKey] = innerFormResult[innerKey];
                });
            }
        }
    });

    return results;
}

/**
 * Returns XML/form-definition validation errors for the selected PAYONE form-backed payment method.
 *
 * @param {string} paymentMethodId - SFCC payment method id.
 * @returns {Object} Flat map of html field names to error messages.
 */
function getPaymentFormErrors(paymentMethodId) {
    var formName;
    var form;

    if (!FORM_VALIDATION_METHODS[paymentMethodId]) {
        return {};
    }

    formName = payoneCommerceCheckoutHelper.forms[paymentMethodId];

    if (!formName) {
        return {};
    }

    form = server.forms.getForm(formName);

    return getFormErrors(form);
}

/**
 * Verifies the required information for the selected PAYONE form and shapes the SFRA billing payload.
 *
 * @param {Object} req - The request object.
 * @param {Object} paymentForm - Billing payment form.
 * @param {Object} viewFormData - Mutable billing data payload.
 * @returns {Object} SFRA form-processor result.
 */
function processForm(req, paymentForm, viewFormData) {
    var paymentMethodId = paymentForm.paymentMethod.value;
    var fieldErrors = getPaymentFormErrors(paymentMethodId);
    var tokenInformation;
    var paymentMethodSpecificInput;
    var customerDataOverride;
    var payonePayPalPaymentContext = null;
    var payoneSecureInstallmentContext = null;
    var approvalData;
    var secureInstallmentSelectionData;
    var secureInstallmentCustomerOverride;
    var invalidSecureInstallmentContext;
    var invalidSecureInstallmentOption;
    var invalidPaymentMessage;
    var basket;
    var viewData = viewFormData;

    viewData.paymentMethod = {
        value: paymentMethodId,
        htmlName: paymentForm.paymentMethod.htmlName
    };

    if (Object.keys(fieldErrors).length) {
        return {
            error: true,
            fieldErrors: fieldErrors,
            serverErrors: []
        };
    }

    if (!payonePaymentMethodSpecificInputBuilder.supportsPaymentMethod(paymentMethodId)) {
        return {
            error: true,
            fieldErrors: {},
            serverErrors: [payonePaymentMethodSpecificInputBuilder.getUnsupportedMethodMessage()]
        };
    }

    tokenInformation = payonePaymentMethodSpecificInputBuilder.getTokenInformation(req, paymentMethodId);
    paymentMethodSpecificInput = payonePaymentMethodSpecificInputBuilder.buildPaymentMethodSpecificInput(paymentMethodId, tokenInformation, req);
    customerDataOverride = payonePaymentMethodSpecificInputBuilder.buildCustomerOverride(paymentMethodId, req);

    if (paymentMethodId === payonePayPalHelper.PAYMENT_METHOD_ID) {
        approvalData = payonePaymentMethodSpecificInputBuilder.getPayPalApprovalData(tokenInformation);
        basket = BasketMgr.getCurrentBasket();
        payonePayPalPaymentContext = approvalData
            ? payonePayPalHelper.getContext(req, approvalData.contextKey)
            : null;

        if (
            !approvalData
            || !payonePayPalPaymentContext
            || !payonePayPalPaymentContext.approved
            || !payonePayPalPaymentContext.completed
            || !payonePayPalHelper.isContextValidForBasket(payonePayPalPaymentContext, basket)
        ) {
            invalidPaymentMessage = Resource.msg('error.payment.not.valid', 'checkout', null);

            if (approvalData) {
                payoneCheckoutRefreshHelper.markSubmitPaymentRefresh(req, invalidPaymentMessage);
            }

            return {
                error: true,
                fieldErrors: {},
                serverErrors: [invalidPaymentMessage]
            };
        }
    }

    if (paymentMethodId === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        secureInstallmentSelectionData = payonePaymentMethodSpecificInputBuilder.getSecureInstallmentSelectionData(tokenInformation);
        basket = BasketMgr.getCurrentBasket();
        secureInstallmentCustomerOverride = payoneSecureInstallmentCheckoutHelper.buildSubmitPaymentCustomerOverride(
            paymentForm,
            viewData,
            customerDataOverride
        );
        payoneSecureInstallmentContext = secureInstallmentSelectionData
            ? payoneSecureInstallmentHelper.getContext(req, secureInstallmentSelectionData.contextKey)
            : null;

        if (!secureInstallmentSelectionData) {
            return {
                error: true,
                fieldErrors: {},
                serverErrors: [Resource.msg('error.payment.not.valid', 'checkout', null)]
            };
        }

        invalidSecureInstallmentContext = !payoneSecureInstallmentContext
            || !payoneSecureInstallmentHelper.isContextValidForBasket(
                payoneSecureInstallmentContext,
                basket,
                secureInstallmentCustomerOverride
            );
        invalidSecureInstallmentOption = !invalidSecureInstallmentContext
            && !payoneSecureInstallmentHelper.hasInstallmentOption(
                payoneSecureInstallmentContext,
                secureInstallmentSelectionData.installmentOptionId
            );

        if (invalidSecureInstallmentContext || invalidSecureInstallmentOption) {
            invalidPaymentMessage = Resource.msg('error.payment.not.valid', 'checkout', null);
            payoneCheckoutContextCleanupHelper.cleanupStoredPreAuthorizationContext(
                req,
                paymentMethodId,
                secureInstallmentSelectionData.contextKey,
                'invalid Secure Installment SubmitPayment cleanup'
            );
            payoneCheckoutRefreshHelper.markSubmitPaymentRefresh(req, invalidPaymentMessage);

            return {
                error: true,
                fieldErrors: {},
                serverErrors: [invalidPaymentMessage]
            };
        }

        if (!payoneSecureInstallmentHelper.hasMatchingBillingAndShippingAddress(
            basket,
            secureInstallmentCustomerOverride
        )) {
            return {
                error: true,
                fieldErrors: {},
                serverErrors: [Resource.msg('payone.error.secure_installment_address_mismatch', 'payoneError', null)]
            };
        }
    }

    if (
        !paymentMethodSpecificInput
        || (payonePaymentMethodSpecificInputBuilder.requiresCustomerOverride(paymentMethodId) && !customerDataOverride)
    ) {
        return {
            error: true,
            fieldErrors: {},
            serverErrors: [Resource.msg('error.payment.not.valid', 'checkout', null)]
        };
    }

    viewData.paymentInformation = {
        payonePaymentMethodSpecificInput: paymentMethodSpecificInput,
        payoneCustomerDataOverride: customerDataOverride,
        payonePayPalPaymentContext: payonePayPalPaymentContext,
        payoneSecureInstallmentContext: payoneSecureInstallmentContext
    };

    return {
        error: false,
        viewData: viewData
    };
}

/**
 * Placeholder wallet-save hook for PAYONE methods.
 *
 * @returns {undefined}
 */
function savePaymentInformation() {
}

exports.processForm = processForm;
exports.savePaymentInformation = savePaymentInformation;
