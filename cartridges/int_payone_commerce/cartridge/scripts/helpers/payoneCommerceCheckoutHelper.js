'use strict';

var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var Site = require('dw/system/Site');
var BasketMgr = require('dw/order/BasketMgr');

var PayoneCommerceCheckoutHelper = {};

/**
 * Returns the current basket when available.
 *
 * @returns {dw.order.Basket|null} Current basket.
 */
function getCurrentBasket() {
    return BasketMgr.getCurrentBasket();
}

/**
 * Returns the current locale with a safe default.
 *
 * @returns {string} Current request locale.
 */
function getCurrentLocale() {
    return request && request.locale ? request.locale : Site.current.getDefaultLocale();
}

/**
 * Returns the current session currency code with a safe default.
 *
 * @returns {string} Current currency code.
 */
function getCurrentCurrencyCode() {
    return session && session.currency && session.currency.currencyCode
        ? session.currency.currencyCode
        : 'EUR';
}

/**
 * Builds safe Google Pay transaction info from the current basket.
 *
 * @returns {Object} Google Pay transaction info.
 */
function getGooglePayTransactionInfo() {
    var basket = getCurrentBasket();
    var firstShipment = basket && basket.shipments && basket.shipments[0];
    var shippingAddress = firstShipment && firstShipment.shippingAddress;
    var countryCode = shippingAddress && shippingAddress.countryCode ? shippingAddress.countryCode.value : '';
    var totalGrossPrice = basket && basket.totalGrossPrice ? basket.totalGrossPrice.value : 0;

    return {
        totalPriceStatus: 'FINAL',
        totalPriceLabel: 'Total',
        totalPrice: Number(totalGrossPrice).toFixed(2),
        currencyCode: getCurrentCurrencyCode(),
        countryCode: countryCode
    };
}

/**
 * Returns the locale used by the hosted tokenizer with a safe fallback for unsupported locales.
 *
 * @param {string} locale - Current request locale.
 * @returns {string} Hosted tokenizer locale.
 */
function getHostedTokenizerLocale(locale) {
    var localeValue = locale;

    if (localeValue === 'fr_FR') {
        return 'en_US';
    }

    return localeValue;
}

/**
 * Returns the language code expected by the Google Pay button.
 *
 * @param {string} locale - Current request locale.
 * @returns {string} Google Pay button locale.
 */
function getGooglePayButtonLocale(locale) {
    return locale.split('_')[0];
}

PayoneCommerceCheckoutHelper.optionPath = {
    "PAYONE_COMMERCE_CARD": {
        "content": "checkout/billing/paymentOptions/payoneCommerceCardContent"
    },
    "PAYONE_COMMERCE_SEPA": {
        "content": "checkout/billing/paymentOptions/payoneCommerceSepaContent"
    },
    "PAYONE_COMMERCE_SECURE_INVOICE": {
        "content": "checkout/billing/paymentOptions/payoneCommerceSecureInvoiceContent"
    },
    "PAYONE_COMMERCE_SECURE_INSTALLMENT": {
        "content": "checkout/billing/paymentOptions/payoneCommerceSecureInstallmentContent"
    },
    "PAYONE_COMMERCE_SECURE_DIRECT_DEBIT": {
        "content": "checkout/billing/paymentOptions/payoneCommerceSecureDirectDebitContent"
    },
    "PAYONE_COMMERCE_PAYPAL": {
        "content": "checkout/billing/paymentOptions/payoneCommercePaypalContent"
    },
    "PAYONE_COMMERCE_GOOGLEPAY": {
        "content": "checkout/billing/paymentOptions/payoneCommerceGooglepayContent"
    },
    "DW_APPLE_PAY": {
        "content": "checkout/billing/paymentOptions/payoneCommerceApplepayContent"
    },
    "PAYONE_COMMERCE_STORE_PAY": {
        "content": "checkout/billing/paymentOptions/payoneCommerceStorePayContent"
    },
    "PAYONE_COMMERCE_WERO": {
        "content": "checkout/billing/paymentOptions/payoneCommerceWeroContent"
    }
}

PayoneCommerceCheckoutHelper.forms = {
    "PAYONE_COMMERCE_CARD": "payoneCommerceCardForm",
    "PAYONE_COMMERCE_SEPA": "payoneCommerceSepaForm",
    "PAYONE_COMMERCE_SECURE_INVOICE": "payoneCommerceSecureInvoiceForm",
    "PAYONE_COMMERCE_SECURE_INSTALLMENT": "payoneCommerceSecureInstallmentForm",
    "PAYONE_COMMERCE_SECURE_DIRECT_DEBIT": "payoneCommerceSecureDirectDebitForm",
    "PAYONE_COMMERCE_PAYPAL": "payoneCommercePaypalForm",
    "PAYONE_COMMERCE_GOOGLEPAY": "payoneCommerceGooglepayForm",
    "PAYONE_COMMERCE_STORE_PAY": "payoneCommerceStorePayForm",
    "PAYONE_COMMERCE_WERO": "payoneCommerceWeroForm"
};

PayoneCommerceCheckoutHelper.getUrls = function () {
    return {
        cardToken: URLUtils.abs('PayoneCommerce-Token').toString(),
        checkoutData: URLUtils.abs('PayoneCommerce-CheckoutData').toString(),
        paymentOptions: URLUtils.abs('PayoneCommerce-PaymentOptions').toString(),
        paypalOrder: URLUtils.abs('PayoneCommerce-PaypalOrder').toString(),
        paypalApprove: URLUtils.abs('PayoneCommerce-PaypalApprove').toString(),
        paypalCancel: URLUtils.abs('PayoneCommerce-PaypalCancel').toString(),
        secureInstallmentOptions: URLUtils.abs('PayoneCommerce-SecureInstallmentOptions').toString(),
        secureInstallmentCancel: URLUtils.abs('PayoneCommerce-SecureInstallmentCancel').toString(),
        updateBillingData: URLUtils.abs('PayoneCommerce-UpdateBillingData').toString()
    };
};

PayoneCommerceCheckoutHelper.getEnvironment = function () {
    return Site.current.getCustomPreferenceValue('payoneEnvironment');
};

PayoneCommerceCheckoutHelper.getLocale = function () {
    return getCurrentLocale();
};

PayoneCommerceCheckoutHelper.getHostedTokenizerLocale = function () {
    return getHostedTokenizerLocale(PayoneCommerceCheckoutHelper.getLocale());
};

PayoneCommerceCheckoutHelper.getGooglePayButtonLocale = function () {
    return getGooglePayButtonLocale(PayoneCommerceCheckoutHelper.getLocale());
};

PayoneCommerceCheckoutHelper.getCustomTextConfigCard = function () {
    var locale = PayoneCommerceCheckoutHelper.getLocale();
    var customTextConfigCard = {};

    customTextConfigCard[locale] = {
        labels: {
            cardNumber: Resource.msg('card.label.cardNumber', 'payoneCommerceCard', null),
            cardholderName: Resource.msg('card.label.cardholderName', 'payoneCommerceCard', null),
            expiryDate: Resource.msg('card.label.expiryDate', 'payoneCommerceCard', null),
            securityCode: Resource.msg('card.label.securityCode', 'payoneCommerceCard', null)
        },
        placeholders: {
            cardNumber: Resource.msg('card.placeholder.cardNumber', 'payoneCommerceCard', null),
            cardholderName: Resource.msg('card.placeholder.cardholderName', 'payoneCommerceCard', null),
            expiryDate: Resource.msg('card.placeholder.expiryDate', 'payoneCommerceCard', null),
            securityCode: Resource.msg('card.placeholder.securityCode', 'payoneCommerceCard', null)
        },
        arialabels: {
            cardNumber: Resource.msg('card.aria.cardNumber', 'payoneCommerceCard', null),
            cardholderName: Resource.msg('card.aria.cardholderName', 'payoneCommerceCard', null),
            expiryDate: Resource.msg('card.aria.expiryDate', 'payoneCommerceCard', null),
            securityCode: Resource.msg('card.aria.securityCode', 'payoneCommerceCard', null)
        },
        errors: {
            cardNumber: {
                isRequired: Resource.msg('card.error.cardNumber.required', 'payoneCommerceCard', null),
                isInvalid: Resource.msg('card.error.cardNumber.invalid', 'payoneCommerceCard', null),
                isTooShort: Resource.msg('card.error.cardNumber.short', 'payoneCommerceCard', null),
                notSupported: Resource.msg('card.error.cardNumber.notSupported', 'payoneCommerceCard', null)
            },
            cardholderName: {
                isRequired: Resource.msg('card.error.cardholderName.required', 'payoneCommerceCard', null),
                isInvalid: Resource.msg('card.error.cardholderName.invalid', 'payoneCommerceCard', null)
            },
            expiryDate: {
                isRequired: Resource.msg('card.error.expiryDate.required', 'payoneCommerceCard', null),
                isInvalid: Resource.msg('card.error.expiryDate.invalid', 'payoneCommerceCard', null)
            },
            securityCode: {
                isRequired: Resource.msg('card.error.securityCode.required', 'payoneCommerceCard', null),
                amexCardSecurityCodeError: Resource.msg('card.error.securityCode.amex', 'payoneCommerceCard', null),
                generalSecurityCodeError: Resource.msg('card.error.securityCode.general', 'payoneCommerceCard', null)
            }
        }
    };

    return customTextConfigCard;
};

PayoneCommerceCheckoutHelper.getHostedFormConfig = function () {
    return {
        iframe: {
            iframeWrapperId: 'payment-IFrame',
            height: 'auto',
            width: 'auto',
            zIndex: 9998
        },
        locale: PayoneCommerceCheckoutHelper.getHostedTokenizerLocale(),
        mode: PayoneCommerceCheckoutHelper.getEnvironment() === 'production' ? 'live' : 'test',
        showCardholderName: true,
        email: '',
        allowedCardSchemes: [
            'visa',
            'mastercard',
            'amex',
            'diners'
        ],
        customIconsConfig: {
            useCustomValidationIcons: false,
            showCardBrandIcons: true,
            successIcon: '/icons/valid.svg',
            errorIcon: '/icons/invalid.svg'
        },
        customTextConfig: PayoneCommerceCheckoutHelper.getCustomTextConfigCard(),
        submitButton: {
            selector: '#validate-payone-card'
        }
    };
};

PayoneCommerceCheckoutHelper.getGooglePayConfig = function () {
    return {
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [
            {
                type: 'CARD',
                parameters: {
                    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                    allowedCardNetworks: ['MASTERCARD', 'VISA'],
                    billingAddressRequired: true
                },
                tokenizationSpecification: {
                    type: 'PAYMENT_GATEWAY',
                    parameters: {
                        gateway: 'payonegmbh',
                        gatewayMerchantId: Site.current.getCustomPreferenceValue('payoneMerchantId')
                    }
                }
            }
        ],
        merchantInfo: {
            merchantId: Site.current.getCustomPreferenceValue('payoneGoogleMerchantId')
        },
        transactionInfo: getGooglePayTransactionInfo()
    };
};

PayoneCommerceCheckoutHelper.getPayPalConfig = function () {
    return {
        'client-id': PayoneCommerceCheckoutHelper.getEnvironment() === 'production'
            ? "AVNBj3ypjSFZ8jE7shhaY2mVydsWsSrjmHk0qJxmgJoWgHESqyoG35jLOhH3GzgEPHmw7dMFnspH6vim"
            : "AUn5n-4qxBUkdzQBv6f8yd8F4AWdEvV6nLzbAifDILhKGCjOS62qQLiKbUbpIKH_O2Z3OL8CvX7ucZfh",
        'merchant-id': Site.current.getCustomPreferenceValue('payonePayPalMerchantId'),
        currency: getCurrentCurrencyCode(),
        intent: 'authorize',
        commit: true,
        locale: PayoneCommerceCheckoutHelper.getLocale(),
        vault: false,
        'disable-funding': 'card,sepa',
        components: 'buttons'
    };
};

PayoneCommerceCheckoutHelper.getSecureInstallmentUi = function () {
    return {
        loadOptionsLabel: Resource.msg('button.secureInstallment.loadOptions', 'payoneCommerceForm', null),
        selectOptionLabel: Resource.msg('button.secureInstallment.selectOption', 'payoneCommerceForm', null),
        unavailableMessage: Resource.msg('error.secureInstallment.unavailable', 'payoneCommerceForm', null),
        loadOptionsErrorMessage: Resource.msg('error.secureInstallment.loadOptions', 'payoneCommerceForm', null),
        selectOptionErrorMessage: Resource.msg('error.secureInstallment.selectOption', 'payoneCommerceForm', null),
        optionsLabel: Resource.msg('label.secureInstallment.options', 'payoneCommerceForm', null)
    };
};

PayoneCommerceCheckoutHelper.getMessages = function () {
    return {
        genericCheckoutError: Resource.msg('error.checkout.generic', 'payoneCommerceForm', null),
        cardValidationError: Resource.msg('error.card.validation', 'payoneCommerceForm', null),
        paypalCreateError: Resource.msg('error.paypal.create', 'payoneCommerceForm', null),
        paypalApproveError: Resource.msg('error.paypal.approve', 'payoneCommerceForm', null),
        billingUpdateError: Resource.msg('error.billing.update', 'payoneCommerceForm', null)
    };
};

/**
* Generates and returns plain arrays representing selectable days, months, and years for date input fields.
*
* @returns {Object} An object containing:
*   - {string[]} days   - Array of day values as strings, from "1" to "31".
*   - {string[]} months - Array of month values as strings, from "1" to "12".
*   - {string[]} years  - Array of year values as strings, from the current year down to 110 years ago.
*/
PayoneCommerceCheckoutHelper.getDobOptions = function () {
    var days = [];
    var months = [];
    var years = [];

    var currentYear = new Date().getFullYear();
    var earliestYear = currentYear - 110;

    // Days: 1 - 31
    for (var d = 1; d <= 31; d++) {
        days.push(d.toFixed(0));
    }

    // Months: 1 - 12
    for (var m = 1; m <= 12; m++) {
        months.push(m.toFixed(0));
    }

    // Years: current year down to 110 years ago
    for (var y = currentYear; y >= earliestYear; y--) {
        years.push(y.toFixed(0));
    }

    return {
        days: days,
        months: months,
        years: years
    };
};

PayoneCommerceCheckoutHelper.cartridgeEnabled = Site.current.getCustomPreferenceValue('payoneEnabled');

/**
* Generates and returns Payla configuration data for the current session, including environment, partner IDs,
* a unique snippet token, and URLs for Payla CSS and JS resources.
*
* @returns {Object} An object containing:
*   - {string} environment - The Payla environment identifier ('p' for production, 't' for test).
*   - {string} paylaPartnerId - The fixed Payla partner ID.
*   - {string} partnerMerchantId - The merchant's Payla ID from site preferences.
*   - {string} snippetToken - A unique token for the session, used for Payla snippet integration.
*   - {string} cssUrl - The URL for the Payla DCS CSS file, parameterized with session and partner data.
*   - {string} jsUrl - The URL for the Payla DCS JavaScript file, parameterized with partner data.
*/
PayoneCommerceCheckoutHelper.getPaylaFingerprintConfig = function () {
    var UUIDUtils = require('dw/util/UUIDUtils');

    var paylaPartnerId = 'e7yeryF2of8X'; // fixed
    var partnerMerchantId = Site.current.getCustomPreferenceValue('payonePaylaId');

    // Generate snippet_token (unique per session per checkout)
    var snippetToken = paylaPartnerId + '_' + partnerMerchantId + '_' + UUIDUtils.createUUID();
    if (!(session && session.privacy && session.privacy.paylaToken)) {
        session.privacy.paylaToken = snippetToken;
    }
    var environment = PayoneCommerceCheckoutHelper.getEnvironment() === 'production'
        ? 'p'
        : 't';

    return {
        environment: environment,
        paylaPartnerId: paylaPartnerId,
        partnerMerchantId: partnerMerchantId,
        snippetToken: session.privacy.paylaToken,
        cssUrl: 'https://d.payla.io/dcs/dcs.css?st=' + session.privacy.paylaToken
            + '&pi=' + paylaPartnerId
            + '&psi=' + partnerMerchantId
            + '&e=' + environment,
        jsUrl: 'https://d.payla.io/dcs/' + paylaPartnerId + '/' + partnerMerchantId + '/dcs.js'
    };
};

PayoneCommerceCheckoutHelper.getPayoneCheckoutData = function () {
    return {
        urls: PayoneCommerceCheckoutHelper.getUrls(),
        locale: PayoneCommerceCheckoutHelper.getLocale(),
        hostedTokenizerLocale: PayoneCommerceCheckoutHelper.getHostedTokenizerLocale(),
        googlePayButtonLocale: PayoneCommerceCheckoutHelper.getGooglePayButtonLocale(),
        environment: PayoneCommerceCheckoutHelper.getEnvironment(),
        paylaFingerprintConfig: PayoneCommerceCheckoutHelper.getPaylaFingerprintConfig(),
        hostedFormConfig: PayoneCommerceCheckoutHelper.getHostedFormConfig(),
        googlePayConfig: PayoneCommerceCheckoutHelper.getGooglePayConfig(),
        payPalConfig: PayoneCommerceCheckoutHelper.getPayPalConfig(),
        messages: PayoneCommerceCheckoutHelper.getMessages(),
        secureInstallmentUi: PayoneCommerceCheckoutHelper.getSecureInstallmentUi()
    };
};

module.exports = PayoneCommerceCheckoutHelper;
