'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Logger = require('dw/system/Logger');
var Money = require('dw/value/Money');
var Resource = require('dw/web/Resource');
var StringUtils = require('dw/util/StringUtils');
var UUIDUtils = require('dw/util/UUIDUtils');

var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');
var CreateCheckoutRequest = require('*/cartridge/scripts/models/payone/CreateCheckoutRequest');
var Customer = require('*/cartridge/scripts/models/payone/Customer');
var OrderRequest = require('*/cartridge/scripts/models/payone/OrderRequest');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneCheckoutFingerprintHelper = require('*/cartridge/scripts/payone/payoneCheckoutFingerprintHelper');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');

var LOGGER = Logger.getLogger('payone', 'secureInstallment');
var PAYMENT_METHOD_ID = 'PAYONE_COMMERCE_SECURE_INSTALLMENT';
var PAYMENT_PRODUCT_ID = 3391;
var SESSION_KEY_PREFIX = 'pSI_';
var readField = PayoneCommonUtils.readField;

/**
 * Reads a JSON object from the session privacy cache.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} key - Cache key.
 * @returns {Object|null} Parsed cached object or null.
 */
function getCachedObject(req, key) {
    var value;

    if (!req || !req.session || !req.session.privacyCache || !key) {
        return null;
    }

    value = req.session.privacyCache.get(key);

    return value ? PayoneCommonUtils.parseJson(value) : null;
}

/**
 * Writes a JSON value to the session privacy cache.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} key - Cache key.
 * @param {Object|null} value - JSON-serializable value.
 * @returns {void}
 */
function setCachedObject(req, key, value) {
    if (!req || !req.session || !req.session.privacyCache || !key) {
        return;
    }

    req.session.privacyCache.set(key, value ? JSON.stringify(value) : null);
}

/**
 * Returns the current basket when available.
 *
 * @returns {dw.order.Basket|null} Current basket.
 */
function getCurrentBasket() {
    return BasketMgr.getCurrentBasket();
}

/**
 * Builds the SHA-256 fingerprint hash for a basket.
 *
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {Object|null} customerOverride - Optional checkout-specific customer override payload.
 * @returns {string|null} Fingerprint hash.
 */
function buildBasketFingerprintHash(basket, customerOverride) {
    return payoneCheckoutFingerprintHelper.buildFingerprintHash(
        basket,
        'basket',
        {
            paymentMethodId: PAYMENT_METHOD_ID,
            basketUUID: basket && basket.UUID ? basket.UUID : null,
            customerOverride: customerOverride || null
        },
        LOGGER,
        'PAYONE Secure Installment'
    );
}

/**
 * Builds the SHA-256 fingerprint hash for an order.
 *
 * @param {dw.order.Order|Object} order - Created order.
 * @param {string|null} basketUUID - Original basket UUID.
 * @param {Object|null} customerOverride - Optional checkout-specific customer override payload.
 * @returns {string|null} Fingerprint hash.
 */
function buildOrderFingerprintHash(order, basketUUID, customerOverride) {
    return payoneCheckoutFingerprintHelper.buildFingerprintHash(
        order,
        'order',
        {
            paymentMethodId: PAYMENT_METHOD_ID,
            basketUUID: basketUUID,
            customerOverride: customerOverride || null
        },
        LOGGER,
        'PAYONE Secure Installment'
    );
}

/**
 * Compares two checkout fingerprint hashes.
 *
 * @param {string|null} left - First fingerprint hash.
 * @param {string|null} right - Second fingerprint hash.
 * @returns {boolean} True when both hashes match.
 */
function isSameFingerprint(left, right) {
    if (!left || !right) {
        return false;
    }

    return left === right;
}

/**
 * Builds a PAYONE customer-device payload for BNPL requests.
 *
 * @param {string} deviceToken - Payla snippet token for the current attempt.
 * @returns {Object|null} PAYONE customerDevice payload.
 */
function buildCustomerDevice(deviceToken) {
    var normalizedDeviceToken = PayoneCommonUtils.trimString(deviceToken, true);
    var ipAddress = typeof request !== 'undefined' && request
        ? (request.httpRemoteAddress || request.remoteAddress || null)
        : null;

    if (!ipAddress && !normalizedDeviceToken) {
        return null;
    }

    return {
        ipAddress: ipAddress,
        deviceToken: normalizedDeviceToken
    };
}

/**
 * Builds the PAYONE financing input used to fetch installment options.
 *
 * @param {Object|null} customerDevice - PAYONE customerDevice payload.
 * @returns {Object} PAYONE payment-method specific input payload.
 */
function buildInitialPaymentMethodSpecificInput(customerDevice) {
    var paymentMethodSpecificInput = {
        financingPaymentMethodSpecificInput: {
            paymentProductId: PAYMENT_PRODUCT_ID
        }
    };

    if (customerDevice) {
        paymentMethodSpecificInput.customerDevice = customerDevice;
    }

    return paymentMethodSpecificInput;
}

/**
 * Builds the PAYONE create-commerce-case request body for a basket-backed Secure Installment attempt.
 *
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {Object|null} customerOverride - Checkout-specific customer override data.
 * @param {string} reservedOrderNo - Reserved SFCC order number.
 * @param {Object|null} customerDevice - PAYONE customerDevice payload.
 * @returns {Object} PAYONE create-commerce-case request payload.
 */
function buildCreateRequestBodyFromBasket(basket, customerOverride, reservedOrderNo, customerDevice) {
    var commerceCaseReference = payoneMerchantReferenceHelper.buildCommerceCaseReference(reservedOrderNo);
    var checkoutReference = payoneMerchantReferenceHelper.buildCheckoutReference(reservedOrderNo);
    var paymentReference = payoneMerchantReferenceHelper.buildPaymentReference(reservedOrderNo);
    var customerModel = Customer.fromBasket(basket, customerOverride);
    var checkoutModel = CreateCheckoutRequest.fromBasket(basket, new OrderRequest({
        orderReferences: {
            merchantReference: paymentReference
        },
        paymentMethodSpecificInput: buildInitialPaymentMethodSpecificInput(customerDevice)
    }));
    var checkoutRequest = checkoutModel.toRequest();

    checkoutRequest.references = checkoutRequest.references || {};
    checkoutRequest.references.merchantReference = checkoutReference;

    return {
        merchantReference: commerceCaseReference,
        customer: customerModel.toRequest(),
        checkout: checkoutRequest
    };
}

/**
 * Extracts a normalized comparable address from an SFCC basket/order source.
 *
 * @param {dw.order.Basket|dw.order.Order|Object} source - Basket or order source.
 * @returns {Object|null} Comparable address payload.
 */
function getSourceBillingAddress(source) {
    var safeSource = source || {};
    var billingAddress = readField(safeSource, 'billingAddress');
    var countryCode;

    if (!billingAddress && typeof safeSource.getBillingAddress === 'function') {
        billingAddress = safeSource.getBillingAddress();
    }

    if (!billingAddress) {
        return null;
    }

    countryCode = readField(billingAddress, 'countryCode');

    return {
        street: PayoneCommonUtils.trimString(
            readField(billingAddress, 'address1') || readField(billingAddress, 'street'),
            true
        ),
        additionalInfo: PayoneCommonUtils.trimString(
            readField(billingAddress, 'address2') || readField(billingAddress, 'additionalInfo'),
            true
        ),
        city: PayoneCommonUtils.trimString(readField(billingAddress, 'city'), true),
        zip: PayoneCommonUtils.trimString(
            readField(billingAddress, 'postalCode') || readField(billingAddress, 'zip'),
            true
        ),
        countryCode: PayoneCommonUtils.trimString(
            countryCode && countryCode.value
                ? countryCode.value
                : countryCode,
            true
        ),
        state: PayoneCommonUtils.trimString(
            readField(billingAddress, 'stateCode') || readField(billingAddress, 'state'),
            true
        )
    };
}

/**
 * Extracts a normalized comparable address from the basket/order shipping shipment.
 *
 * @param {dw.order.Basket|dw.order.Order|Object} source - Basket or order source.
 * @returns {Object|null} Comparable shipping address payload.
 */
function getSourceShippingAddress(source) {
    var safeSource = source || {};
    var defaultShipment = typeof safeSource.getDefaultShipment === 'function'
        ? safeSource.getDefaultShipment()
        : readField(safeSource, 'defaultShipment');
    var shippingAddress = defaultShipment && typeof defaultShipment.getShippingAddress === 'function'
        ? defaultShipment.getShippingAddress()
        : readField(defaultShipment, 'shippingAddress');
    var countryCode;

    if (!shippingAddress) {
        return null;
    }

    countryCode = readField(shippingAddress, 'countryCode');

    return {
        street: PayoneCommonUtils.trimString(
            readField(shippingAddress, 'address1') || readField(shippingAddress, 'street'),
            true
        ),
        additionalInfo: PayoneCommonUtils.trimString(
            readField(shippingAddress, 'address2') || readField(shippingAddress, 'additionalInfo'),
            true
        ),
        city: PayoneCommonUtils.trimString(readField(shippingAddress, 'city'), true),
        zip: PayoneCommonUtils.trimString(
            readField(shippingAddress, 'postalCode') || readField(shippingAddress, 'zip'),
            true
        ),
        countryCode: PayoneCommonUtils.trimString(
            countryCode && countryCode.value
                ? countryCode.value
                : countryCode,
            true
        ),
        state: PayoneCommonUtils.trimString(
            readField(shippingAddress, 'stateCode') || readField(shippingAddress, 'state'),
            true
        )
    };
}

/**
 * Builds a comparable billing address payload from checkout override data.
 *
 * @param {Object|null} customerOverride - Checkout customer override payload.
 * @param {Object|null} fallbackAddress - Fallback address payload.
 * @returns {Object|null} Comparable billing address payload.
 */
function getComparableBillingAddress(customerOverride, fallbackAddress) {
    var billingAddress = customerOverride && customerOverride.billingAddress;

    if (!billingAddress) {
        return fallbackAddress;
    }

    return {
        street: PayoneCommonUtils.trimString(billingAddress && billingAddress.street, true),
        additionalInfo: PayoneCommonUtils.trimString(billingAddress && billingAddress.additionalInfo, true),
        city: PayoneCommonUtils.trimString(billingAddress && billingAddress.city, true),
        zip: PayoneCommonUtils.trimString(billingAddress && billingAddress.zip, true),
        countryCode: PayoneCommonUtils.trimString(billingAddress && billingAddress.countryCode, true),
        state: PayoneCommonUtils.trimString(billingAddress && billingAddress.state, true)
    };
}

/**
 * Checks whether billing and shipping addresses match for PAYONE Secured Installment.
 *
 * @param {dw.order.Basket|dw.order.Order|Object} source - Basket or order source.
 * @param {Object|null} customerOverride - Optional billing override payload.
 * @returns {boolean} True when billing and shipping addresses match.
 */
function hasMatchingBillingAndShippingAddress(source, customerOverride) {
    var billingAddress = getComparableBillingAddress(customerOverride, getSourceBillingAddress(source));
    var shippingAddress = getSourceShippingAddress(source);
    var fields;

    if (!billingAddress || !shippingAddress) {
        return false;
    }

    fields = ['street', 'additionalInfo', 'city', 'zip', 'countryCode'];

    return fields.every(function (field) {
        return (billingAddress[field] || null) === (shippingAddress[field] || null);
    });
}

/**
 * Extracts installment options from a PAYONE create/get response.
 *
 * @param {Object} response - PAYONE response wrapper or payload.
 * @returns {Array<Object>} Installment options.
 */
function getInstallmentOptions(response) {
    var checkout = payoneCheckoutStateHelper.getCheckout(response);
    var payment = checkout && checkout.paymentResponse && checkout.paymentResponse.payment;
    var paymentOutput = payment && payment.paymentOutput;
    var financingOutput = paymentOutput && paymentOutput.financingPaymentMethodSpecificOutput;
    var specificOutput = financingOutput && financingOutput.paymentProduct3391SpecificOutput;
    var options = specificOutput && specificOutput.installmentOptions;

    return Array.isArray(options) ? options : [];
}

/**
 * Formats a PAYONE amount-of-money object using storefront formatting.
 *
 * @param {Object} amountOfMoney - PAYONE amount object in cents.
 * @returns {string|null} Localized money string or null.
 */
function formatInstallmentMoney(amountOfMoney) {
    var amount = amountOfMoney && typeof amountOfMoney.amount === 'number'
        ? amountOfMoney.amount
        : null;
    var currencyCode = PayoneCommonUtils.trimString(
        amountOfMoney && amountOfMoney.currencyCode,
        true
    );

    if (amount === null || !currencyCode) {
        return null;
    }

    return StringUtils.formatMoney(new Money(Number(amount) / 100, currencyCode));
}

/**
 * Formats PAYONE effective-interest values as storefront-localized percentages.
 *
 * @param {number} effectiveInterestRate - PAYONE rate value.
 * @returns {string|null} Localized percentage string or null.
 */
function formatEffectiveInterestRate(effectiveInterestRate) {
    var normalizedRate = Number(effectiveInterestRate);

    // eslint-disable-next-line no-restricted-globals
    if (isNaN(normalizedRate)) {
        return null;
    }

    return StringUtils.formatNumber(normalizedRate / 100, '0.00') + '%';
}

/**
 * Builds the localized display label for one Secure Installment option.
 *
 * @param {Object} option - PAYONE installment option.
 * @returns {string} Human-readable localized option label.
 */
function buildInstallmentOptionDisplayLabel(option) {
    var parts = [];
    var monthlyAmountLabel = formatInstallmentMoney(option && option.monthlyAmount);
    var totalAmountLabel = formatInstallmentMoney(option && option.totalAmount);
    var effectiveInterestLabel = formatEffectiveInterestRate(option && option.effectiveInterestRate);

    if (option && option.numberOfPayments) {
        parts.push(Resource.msgf(
            'label.secureInstallment.option.payments',
            'payoneCommerceForm',
            null,
            option.numberOfPayments
        ));
    }

    if (monthlyAmountLabel) {
        parts.push(Resource.msgf(
            'label.secureInstallment.option.monthly',
            'payoneCommerceForm',
            null,
            monthlyAmountLabel
        ));
    }

    if (totalAmountLabel) {
        parts.push(Resource.msgf(
            'label.secureInstallment.option.total',
            'payoneCommerceForm',
            null,
            totalAmountLabel
        ));
    }

    if (effectiveInterestLabel) {
        parts.push(Resource.msgf(
            'label.secureInstallment.option.effectiveInterest',
            'payoneCommerceForm',
            null,
            effectiveInterestLabel
        ));
    }

    return parts.join(' | ');
}

/**
 * Builds the frontend display model for one Secure Installment option.
 *
 * @param {Object} option - PAYONE installment option.
 * @returns {{installmentOptionId:string, displayLabel:string}|null} Localized option view model.
 */
function buildInstallmentOptionDisplayModel(option) {
    var installmentOptionId = PayoneCommonUtils.trimString(option && option.installmentOptionId, true);

    if (!installmentOptionId) {
        return null;
    }

    return {
        installmentOptionId: installmentOptionId,
        displayLabel: buildInstallmentOptionDisplayLabel(option)
    };
}

/**
 * Builds localized frontend display models for Secure Installment options.
 *
 * @param {Array<Object>} options - PAYONE installment options.
 * @returns {Array<Object>} Localized option view models.
 */
function buildInstallmentOptionDisplayModels(options) {
    return (options || []).map(buildInstallmentOptionDisplayModel).filter(function (option) {
        return !!option;
    });
}

/**
 * Builds and stores a new Secure Installment context for the current basket.
 *
 * @param {Object} req - SFRA request object.
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {Object} createResult - PAYONE create response.
 * @param {string} reservedOrderNo - Reserved SFCC order number.
 * @param {Object|null} customerOverride - Checkout-specific customer override data.
 * @returns {Object|null} Stored context or null.
 */
function storeCreateContext(req, basket, createResult, reservedOrderNo, customerOverride) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);
    var paymentExecution = payoneCheckoutStateHelper.getPaymentExecution(checkout);
    var installmentOptions = getInstallmentOptions(createResult);
    var contextKey = UUIDUtils.createUUID().replace(/-/g, '');
    var storedContext;
    var responseContext;

    if (!(checkout && checkout.checkoutId && installmentOptions.length)) {
        LOGGER.error(
            'PAYONE Secure Installment create response is missing installment options for basket {0}.',
            basket && basket.UUID ? basket.UUID : 'unknown'
        );
        return null;
    }

    storedContext = {
        contextKey: contextKey,
        basketUUID: basket && basket.UUID ? basket.UUID : null,
        merchantReference: payoneMerchantReferenceHelper.buildCheckoutReference(reservedOrderNo),
        commerceCaseId: createResult && createResult.data ? createResult.data.commerceCaseId : null,
        checkoutId: checkout.checkoutId,
        paymentExecutionId: paymentExecution && paymentExecution.paymentExecutionId ? paymentExecution.paymentExecutionId : null,
        checkoutFingerprintHash: buildBasketFingerprintHash(basket, customerOverride),
        checkoutPaymentStatus: payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout),
        latestPaymentEventStatus: payoneCheckoutStateHelper.getLatestPaymentEventStatus(checkout) || null,
        installmentOptionIds: installmentOptions.map(function (option) {
            return option && option.installmentOptionId ? option.installmentOptionId : null;
        }).filter(function (installmentOptionId) {
            return !!installmentOptionId;
        })
    };

    if (!storedContext.checkoutFingerprintHash) {
        LOGGER.error(
            'PAYONE Secure Installment checkout fingerprint could not be built for basket {0}.',
            storedContext.basketUUID || 'unknown'
        );
        return null;
    }

    setCachedObject(req, SESSION_KEY_PREFIX + contextKey, storedContext);

    responseContext = JSON.parse(JSON.stringify(storedContext));
    responseContext.installmentOptions = buildInstallmentOptionDisplayModels(installmentOptions);

    return responseContext;
}

/**
 * Loads the stored Secure Installment context for the given key.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} contextKey - Context key returned to the browser.
 * @returns {Object|null} Stored context or null.
 */
function getContext(req, contextKey) {
    return getCachedObject(req, SESSION_KEY_PREFIX + PayoneCommonUtils.trimString(contextKey, true));
}

/**
 * Deletes a stored Secure Installment context.
 *
 * @param {Object} req - SFRA request object.
 * @param {string} contextKey - Context key.
 * @returns {void}
 */
function clearContext(req, contextKey) {
    setCachedObject(req, SESSION_KEY_PREFIX + PayoneCommonUtils.trimString(contextKey, true), null);
}

/**
 * Loads the latest PAYONE checkout state for the given commerce case.
 *
 * @param {string} commerceCaseId - PAYONE commerce case UUID.
 * @param {string} checkoutId - PAYONE checkout UUID.
 * @returns {{getResult:Object, checkout:(Object|null)}} Latest state result.
 */
function getCheckoutState(commerceCaseId, checkoutId) {
    var getResult;
    var checkout;

    getResult = commerceCaseService.get(commerceCaseId, {});
    checkout = payoneCheckoutStateHelper.getCheckout(getResult, checkoutId);

    return {
        getResult: getResult,
        checkout: checkout
    };
}

/**
 * Validates that the stored Secure Installment context still matches the current basket.
 *
 * @param {Object} context - Stored server-side context.
 * @param {dw.order.Basket|Object} basket - Current basket.
 * @param {Object|null} customerOverride - Optional checkout-specific customer override payload.
 * @returns {boolean} True when the context still matches the basket state.
 */
function isContextValidForBasket(context, basket, customerOverride) {
    return !!(
        context
        && context.basketUUID
        && basket
        && context.basketUUID === basket.UUID
        && isSameFingerprint(context.checkoutFingerprintHash, buildBasketFingerprintHash(basket, customerOverride))
    );
}

/**
 * Validates that the stored Secure Installment context still matches the created order state.
 *
 * @param {Object} context - Stored server-side context.
 * @param {dw.order.Order|Object} order - Created order.
 * @param {Object|null} customerOverride - Optional checkout-specific customer override payload.
 * @returns {boolean} True when the context still matches the order state.
 */
function isContextValidForOrder(context, order, customerOverride) {
    return isSameFingerprint(
        context && context.checkoutFingerprintHash,
        buildOrderFingerprintHash(
            order,
            context && context.basketUUID ? context.basketUUID : null,
            customerOverride
        )
    );
}

/**
 * Indicates whether the given installment option belongs to the stored context.
 *
 * @param {Object} context - Stored context.
 * @param {string} installmentOptionId - Selected installment option id.
 * @returns {boolean} True when the option exists in the context.
 */
function hasInstallmentOption(context, installmentOptionId) {
    var normalizedOptionId = PayoneCommonUtils.trimString(installmentOptionId, true);
    var optionIds = context && context.installmentOptionIds;
    var options = context && context.installmentOptions;

    if (Array.isArray(optionIds)) {
        return optionIds.indexOf(normalizedOptionId) !== -1;
    }

    return !!((options || []).filter(function (option) {
        return option && option.installmentOptionId === normalizedOptionId;
    }).length);
}

module.exports = {
    PAYMENT_METHOD_ID: PAYMENT_METHOD_ID,
    PAYMENT_PRODUCT_ID: PAYMENT_PRODUCT_ID,
    buildBasketFingerprintHash: buildBasketFingerprintHash,
    buildCreateRequestBodyFromBasket: buildCreateRequestBodyFromBasket,
    buildCustomerDevice: buildCustomerDevice,
    buildInitialPaymentMethodSpecificInput: buildInitialPaymentMethodSpecificInput,
    clearContext: clearContext,
    getCheckoutState: getCheckoutState,
    hasMatchingBillingAndShippingAddress: hasMatchingBillingAndShippingAddress,
    getContext: getContext,
    getCurrentBasket: getCurrentBasket,
    getInstallmentOptions: getInstallmentOptions,
    buildInstallmentOptionDisplayModels: buildInstallmentOptionDisplayModels,
    hasInstallmentOption: hasInstallmentOption,
    isContextValidForBasket: isContextValidForBasket,
    isContextValidForOrder: isContextValidForOrder,
    storeCreateContext: storeCreateContext
};
