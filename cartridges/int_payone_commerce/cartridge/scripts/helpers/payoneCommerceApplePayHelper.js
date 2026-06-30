'use strict';

var Site = require('dw/system/Site');

var PayoneCommerceApplePayHelper = {};

PayoneCommerceApplePayHelper.PAYMENT_METHOD_ID = "DW_APPLE_PAY";

PayoneCommerceApplePayHelper.getIntegrationType = function () {
    var integrationType = Site.current.getCustomPreferenceValue('payoneApplePayIntegrationType');
    return integrationType && integrationType.value || "MERCHANT_CERTIFICATE";
}

PayoneCommerceApplePayHelper.useShippingAddressFromCheckoutForm = Site.current.getCustomPreferenceValue('payoneApplePayUseShippingAddressFromCheckoutForm') || false;
PayoneCommerceApplePayHelper.useBillingAddressFromCheckoutForm = Site.current.getCustomPreferenceValue('payoneApplePayUseBillingAddressFromCheckoutForm') || false;
PayoneCommerceApplePayHelper.useShippingMethodFromCheckoutForm = Site.current.getCustomPreferenceValue('payoneApplePayUseShippingMethodFromCheckoutForm') || false;

module.exports = PayoneCommerceApplePayHelper;
