'use strict';

var server = require('server');
var Resource = require('dw/web/Resource');

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payonePaymentMethodSpecificInputBuilder = require('*/cartridge/scripts/payone/payonePaymentMethodSpecificInputBuilder');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');
var Customer = require('*/cartridge/scripts/models/payone/Customer');

/**
 * Reads a posted checkout field safely.
 *
 * @param {Object} req - Current request.
 * @param {string} fieldName - Posted form field name.
 * @returns {string|null} Trimmed field value or null.
 */
function getPostedValue(req, fieldName) {
    return PayoneCommonUtils.trimString(req && req.form ? req.form[fieldName] : null, true);
}

/**
 * Reads a billing form field value safely.
 *
 * @param {Object} billingForm - SFRA billing form object.
 * @param {string[]} fieldPath - Nested form path.
 * @returns {string|null} Trimmed field value or null.
 */
function getBillingFormValue(billingForm, fieldPath) {
    var currentField = billingForm;
    var i;

    for (i = 0; currentField && fieldPath && i < fieldPath.length; i += 1) {
        currentField = currentField[fieldPath[i]];
    }

    return PayoneCommonUtils.trimString(
        currentField && Object.prototype.hasOwnProperty.call(currentField, 'value')
            ? currentField.value
            : null
    );
}

/**
 * Reads a SubmitPayment view-data field value safely.
 *
 * @param {Object} source - View-data field container.
 * @param {string} fieldName - Field name to read.
 * @returns {string|null} Trimmed field value or null.
 */
function getViewDataValue(source, fieldName) {
    var field = source && fieldName ? source[fieldName] : null;

    return PayoneCommonUtils.trimString(
        field && Object.prototype.hasOwnProperty.call(field, 'value')
            ? field.value
            : null,
        true
    );
}

/**
 * Builds a lightweight customer override payload from the current billing form state.
 *
 * @returns {Object|null} Billing-form override payload.
 */
function buildBillingCustomerOverride() {
    var billingForm = server.forms.getForm('billing');

    if (!billingForm) {
        return null;
    }

    return {
        billingAddress: {
            street: getBillingFormValue(billingForm, ['addressFields', 'address1']),
            additionalInfo: getBillingFormValue(billingForm, ['addressFields', 'address2']),
            city: getBillingFormValue(billingForm, ['addressFields', 'city']),
            zip: getBillingFormValue(billingForm, ['addressFields', 'postalCode']),
            countryCode: getBillingFormValue(billingForm, ['addressFields', 'country']),
            state: getBillingFormValue(billingForm, ['addressFields', 'states', 'stateCode'])
        },
        contactDetails: {
            emailAddress: getBillingFormValue(billingForm, ['contactInfoFields', 'email'])
        },
        personalInformation: {
            name: {
                firstName: getBillingFormValue(billingForm, ['addressFields', 'firstName']),
                surname: getBillingFormValue(billingForm, ['addressFields', 'lastName'])
            }
        }
    };
}

/**
 * Builds a billing override from the current SubmitPayment request payload.
 *
 * SubmitPayment validates the PAYONE method before SFRA writes the posted billing
 * address into the basket, so Secure Installment must compare against the
 * current request payload instead of the stale basket billing address.
 *
 * @param {Object} paymentForm - Billing payment form.
 * @param {Object} viewData - Mutable billing data payload.
 * @returns {Object|null} Billing override payload.
 */
function buildSubmitPaymentBillingOverride(paymentForm, viewData) {
    var address = viewData && viewData.address ? viewData.address : null;
    var contactInfoFields = paymentForm && paymentForm.contactInfoFields ? paymentForm.contactInfoFields : null;

    if (!address) {
        return null;
    }

    return {
        billingAddress: {
            street: getViewDataValue(address, 'address1'),
            additionalInfo: getViewDataValue(address, 'address2'),
            city: getViewDataValue(address, 'city'),
            zip: getViewDataValue(address, 'postalCode'),
            countryCode: getViewDataValue(address, 'countryCode'),
            state: getViewDataValue(address, 'stateCode')
        },
        contactDetails: {
            emailAddress: getViewDataValue(contactInfoFields, 'email')
        },
        personalInformation: {
            name: {
                firstName: getViewDataValue(address, 'firstName'),
                surname: getViewDataValue(address, 'lastName')
            }
        }
    };
}

/**
 * Builds customer override data from the current billing/contact forms for Secure Installment option loading.
 *
 * @param {Object} req - Current request.
 * @returns {Object|null} Checkout-specific customer override data.
 */
function buildCustomerOverride(req) {
    var paymentOverride = payonePaymentMethodSpecificInputBuilder.buildCustomerOverride(
        payoneSecureInstallmentHelper.PAYMENT_METHOD_ID,
        req
    );
    var billingOverride = buildBillingCustomerOverride();

    return Customer.mergeOverrideData(billingOverride, paymentOverride);
}

/**
 * Builds Secure Installment customer override data for SubmitPayment validation.
 *
 * @param {Object} paymentForm - Billing payment form.
 * @param {Object} viewData - Mutable billing data payload.
 * @param {Object|null} paymentOverride - Method-specific override payload.
 * @returns {Object|null} Checkout-specific customer override data.
 */
function buildSubmitPaymentCustomerOverride(paymentForm, viewData, paymentOverride) {
    return Customer.mergeOverrideData(
        buildSubmitPaymentBillingOverride(paymentForm, viewData),
        paymentOverride
    );
}

/**
 * Stores the posted Payla device token for later BNPL requests and returns the current customerDevice payload.
 *
 * @param {Object} req - Current request.
 * @returns {Object|null} PAYONE customerDevice payload.
 */
function buildCustomerDevice(req) {
    var deviceToken = getPostedValue(req, 'paylaDeviceToken');

    if (!deviceToken && session && session.privacy) {
        deviceToken = session.privacy.paylaToken || null;
    }

    if (deviceToken && session && session.privacy) {
        session.privacy.paylaToken = deviceToken;
    }

    return payoneSecureInstallmentHelper.buildCustomerDevice(deviceToken);
}

/**
 * Resolves the effective checkout email used for Secured Installment option loading.
 *
 * @param {dw.order.Basket} basket - Current basket.
 * @param {Object|null} customerOverride - Checkout-specific customer override data.
 * @returns {string|null} Effective customer email.
 */
function getEffectiveEmail(basket, customerOverride) {
    return PayoneCommonUtils.trimString(
        customerOverride
            && customerOverride.contactDetails
            && customerOverride.contactDetails.emailAddress,
        true
    ) || PayoneCommonUtils.trimString(basket && basket.customerEmail, true);
}

/**
 * Builds required-field errors for the Secure Installment AJAX pre-check route.
 *
 * This route loads installment options before the normal SubmitPayment flow runs,
 * so it must validate the posted payment fields directly instead of relying on
 * SFCC form invalid-state propagation.
 *
 * @param {Object} req - Current request.
 * @returns {Object} Flat map of html field names to error messages.
 */
function getFieldErrors(req) {
    var requiredMessage = Resource.msg('error.message.required', 'forms', null);
    var fieldErrors = {};
    var paymentForm = server.forms.getForm('payoneCommerceSecureInstallmentForm');
    var requiredFields = paymentForm ? [
        paymentForm.secureInstallmentIban,
        paymentForm.secureInstallmentPhoneNumber,
        paymentForm.secureInstallmentBirthDay,
        paymentForm.secureInstallmentBirthMonth,
        paymentForm.secureInstallmentBirthYear
    ] : [];

    requiredFields.forEach(function (field) {
        if (!field || !field.htmlName) {
            return;
        }

        if (!getPostedValue(req, field.htmlName)) {
            fieldErrors[field.htmlName] = requiredMessage;
        }
    });

    return fieldErrors;
}

module.exports = {
    buildCustomerDevice: buildCustomerDevice,
    buildCustomerOverride: buildCustomerOverride,
    buildSubmitPaymentCustomerOverride: buildSubmitPaymentCustomerOverride,
    getEffectiveEmail: getEffectiveEmail,
    getFieldErrors: getFieldErrors
};
