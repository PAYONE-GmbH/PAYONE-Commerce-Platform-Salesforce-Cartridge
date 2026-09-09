'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Encoding = require('dw/crypto/Encoding');
var SecureRandom = require('dw/crypto/SecureRandom');
var OrderMgr = require('dw/order/OrderMgr');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');

var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');
var paymentExecutionService = require('*/cartridge/scripts/services/paymentExecutionService');
var CreateCheckoutRequest = require('*/cartridge/scripts/models/payone/CreateCheckoutRequest');
var CompletePaymentRequest = require('*/cartridge/scripts/models/payone/CompletePaymentRequest');
var Customer = require('*/cartridge/scripts/models/payone/Customer');
var OrderRequest = require('*/cartridge/scripts/models/payone/OrderRequest');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var payonePayPalHelper = require('*/cartridge/scripts/payone/payonePayPalHelper');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');
var payonePaymentTransactionSaver = require('*/cartridge/scripts/payone/payonePaymentTransactionSaver');
var payoneCard3DSHelper = require('*/cartridge/scripts/payone/payoneCard3DSHelper');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');
var parseJson = PayoneCommonUtils.parseJson;
var readCustomAttribute = PayoneCommonUtils.readCustomAttribute;
var STORE_PAY_PAYMENT_METHOD_ID = 'PAYONE_COMMERCE_STORE_PAY';
var WERO_PAYMENT_PRODUCT_ID = 900;
var LOGGER = Logger.getLogger('payone', 'checkout');

/**
 * Resolves the current request IP when available.
 *
 * @returns {string|null} Client IP address.
 */
function getIpAddress() {
    if (typeof request === 'undefined' || !request) {
        return null;
    }

    return request.httpRemoteAddress || request.remoteAddress || null;
}

/**
 * Resolves a stable device token from session/order context.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @returns {string|null} Device token value.
 */
function getDeviceToken(order) {
    if (typeof session !== 'undefined' && session && session.privacy && session.privacy.paylaToken) {
        return session.privacy.paylaToken;
    }

    if (typeof session !== 'undefined' && session && session.sessionID) {
        return session.sessionID;
    }

    return order && order.orderNo ? order.orderNo : null;
}

/**
 * Builds customer device payload when request/session context is available.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @returns {Object|null} PAYONE customer device object.
 */
function buildCustomerDevice(order) {
    var ipAddress = getIpAddress();
    var deviceToken = getDeviceToken(order);

    if (!ipAddress && !deviceToken) {
        return null;
    }

    return {
        ipAddress: ipAddress,
        deviceToken: deviceToken
    };
}

/**
 * Normalizes explicit payment-method specific input already attached to the payment instrument.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object|null} Explicit method-specific input when present.
 */
function getExplicitPaymentMethodSpecificInput(paymentInstrument) {
    var customPayload = readCustomAttribute(paymentInstrument, 'payonePaymentMethodSpecificInput');

    if (customPayload && typeof customPayload === 'object') {
        return customPayload;
    }

    if (typeof customPayload === 'string') {
        return parseJson(customPayload);
    }

    return null;
}

/**
 * Resolves a serialized checkout payload stored on the payment instrument.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @param {string} attributeId - Custom attribute id.
 * @returns {Object|null} Parsed payload or null.
 */
function getExplicitCheckoutPayload(paymentInstrument, attributeId) {
    var customPayload = readCustomAttribute(paymentInstrument, attributeId);

    if (customPayload && typeof customPayload === 'object') {
        return customPayload;
    }

    if (typeof customPayload === 'string') {
        return parseJson(customPayload);
    }

    return null;
}

/**
 * Finds the matching payment instrument on the current basket when it is still available.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Order payment instrument.
 * @returns {dw.order.PaymentInstrument|Object|null} Matching basket payment instrument or null.
 */
function getCurrentBasketPaymentInstrument(paymentInstrument) {
    var currentBasket;
    var paymentMethod;
    var paymentInstruments;
    var i;

    if (!paymentInstrument || !paymentInstrument.paymentMethod) {
        return null;
    }

    currentBasket = BasketMgr.getCurrentBasket();
    paymentMethod = paymentInstrument.paymentMethod;

    if (!currentBasket) {
        return null;
    }

    paymentInstruments = currentBasket.getPaymentInstruments(paymentMethod);

    for (i = 0; i < paymentInstruments.length; i += 1) {
        if (paymentInstruments[i].paymentMethod === paymentMethod) {
            return paymentInstruments[i];
        }
    }

    return null;
}

/**
 * Resolves checkout customer override data for the current payment attempt.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object|null} Customer override payload or null.
 */
function getCustomerDataOverride(paymentInstrument) {
    var explicitPayload = getExplicitCheckoutPayload(paymentInstrument, 'payoneCustomerDataOverride');
    var basketPaymentInstrument;

    if (explicitPayload) {
        return explicitPayload;
    }

    basketPaymentInstrument = getCurrentBasketPaymentInstrument(paymentInstrument);

    return basketPaymentInstrument
        ? getExplicitCheckoutPayload(basketPaymentInstrument, 'payoneCustomerDataOverride')
        : null;
}

/**
 * Resolves a stored PayPal JS SDK context for the current payment attempt.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object|null} Stored PayPal context or null.
 */
function getPayPalPaymentContext(paymentInstrument) {
    var explicitPayload = getExplicitCheckoutPayload(paymentInstrument, 'payonePayPalPaymentContext');
    var basketPaymentInstrument;

    if (explicitPayload) {
        return explicitPayload;
    }

    basketPaymentInstrument = getCurrentBasketPaymentInstrument(paymentInstrument);

    return basketPaymentInstrument
        ? getExplicitCheckoutPayload(basketPaymentInstrument, 'payonePayPalPaymentContext')
        : null;
}

/**
 * Resolves a stored Secure Installment context for the current payment attempt.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object|null} Stored Secure Installment context or null.
 */
function getSecureInstallmentContext(paymentInstrument) {
    var explicitPayload = getExplicitCheckoutPayload(paymentInstrument, 'payoneSecureInstallmentContext');
    var basketPaymentInstrument;

    if (explicitPayload) {
        return explicitPayload;
    }

    basketPaymentInstrument = getCurrentBasketPaymentInstrument(paymentInstrument);

    return basketPaymentInstrument
        ? getExplicitCheckoutPayload(basketPaymentInstrument, 'payoneSecureInstallmentContext')
        : null;
}

/**
 * Formats a date object as YYYYMMDD.
 *
 * @param {Date} date - Date source.
 * @returns {string} Formatted date string.
 */
function formatAsPayoneDate(date) {
    var safeDate = date instanceof Date ? date : new Date();

    return safeDate.getFullYear()
        + ('0' + (safeDate.getMonth() + 1)).slice(-2)
        + ('0' + safeDate.getDate()).slice(-2);
}

/**
 * Resolves the payment-method specific input for the authorization request.
 * The selected PAYONE method payload must be prepared earlier in the checkout flow
 * and attached to the payment instrument.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object|null} PAYONE paymentMethodSpecificInput payload.
 */
function buildPaymentMethodSpecificInput(paymentInstrument) {
    var explicitInput = getExplicitPaymentMethodSpecificInput(paymentInstrument);
    var basketPaymentInstrument;

    if (explicitInput) {
        return explicitInput;
    }

    basketPaymentInstrument = getCurrentBasketPaymentInstrument(paymentInstrument);

    if (basketPaymentInstrument) {
        return getExplicitPaymentMethodSpecificInput(basketPaymentInstrument);
    }

    return null;
}

/**
 * Generates a cryptographically strong URL-safe token for a PAYONE post-redirect return.
 *
 * @returns {string} Random URL-safe token.
 */
function generatePostRedirectReturnNonce() {
    var secureRandom = new SecureRandom();
    var randomBytes = secureRandom.nextBytes(12);

    return Encoding.toBase64URL(randomBytes);
}

/**
 * Ensures the current payment attempt has a stored nonce for the PAYONE post-redirect return flow.
 *
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument for the current order.
 * @returns {string|null} Existing or newly generated return nonce.
 */
function ensurePostRedirectReturnNonce(paymentInstrument) {
    var paymentTransaction = paymentInstrument && paymentInstrument.paymentTransaction;
    var existingNonce = readCustomAttribute(paymentTransaction, 'payonePostRedirectReturnNonce');
    var createdNonce = null;

    if (existingNonce) {
        return existingNonce;
    }

    if (!paymentTransaction) {
        return null;
    }

    createdNonce = generatePostRedirectReturnNonce();

    Transaction.wrap(function () {
        try {
            paymentTransaction.custom.payonePostRedirectReturnNonce = createdNonce;
        } catch (e) {
            LOGGER.error(
                'PAYONE post-redirect return nonce could not be saved on payment transaction. Error: {0}. Stack: {1}',
                e.message,
                e.stack
            );
            createdNonce = null;
        }
    });

    return createdNonce;
}

/**
 * Builds the PAYONE post-redirect return URL for the current order and payment attempt.
 *
 * @param {dw.order.Order|Object} order - Order being authorized.
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument for the current order.
 * @returns {string|null} Absolute return URL.
 */
function buildReturnUrl(order, paymentInstrument) {
    var orderNo = order && order.orderNo ? order.orderNo : null;
    var postRedirectReturnNonce = ensurePostRedirectReturnNonce(paymentInstrument);
    var returnUrl;

    if (!orderNo) {
        LOGGER.error('PAYONE post-redirect return URL could not be built because the order number is missing.');
        return null;
    }

    if (!postRedirectReturnNonce) {
        LOGGER.error(
            'PAYONE post-redirect return URL could not be built for order {0} because no return nonce is available.',
            orderNo
        );
        return null;
    }

    try {
        returnUrl = URLUtils.https(
            'PayoneCommerce-PostRedirectReturn',
            'orderNo',
            orderNo,
            'nonce',
            postRedirectReturnNonce
        ).toString();
    } catch (e) {
        LOGGER.error(
            'PAYONE post-redirect return URL could not be built for order {0}. Error: {1}. Stack: {2}',
            orderNo,
            e.message,
            e.stack
        );
        return null;
    }

    if (!returnUrl || returnUrl.indexOf('https://') !== 0) {
        LOGGER.error(
            'PAYONE post-redirect return URL is invalid for order {0}. Built URL: {1}',
            orderNo,
            returnUrl || 'empty'
        );
        return null;
    }

    return returnUrl;
}

/**
 * Builds the cardholder name from the SFCC billing address for PAYONE card input.
 *
 * @param {dw.order.Order|Object} order - Order being authorized.
 * @returns {string|null} Cardholder name.
 */
function getCardholderName(order) {
    var billingAddress = order && order.billingAddress ? order.billingAddress : null;
    var parts = [];

    if (!billingAddress) {
        return null;
    }

    if (billingAddress.firstName) {
        parts.push(billingAddress.firstName);
    }

    if (billingAddress.lastName) {
        parts.push(billingAddress.lastName);
    }

    return parts.length ? parts.join(' ') : null;
}

/**
 * Enriches PAYONE input with payment-method data required at order authorization time.
 *
 * @param {dw.order.Order|Object} order - Order being authorized.
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument for the current order.
 * @param {Object|null} paymentMethodSpecificInput - PAYONE payment method specific input.
 * @returns {Object|null} Enriched PAYONE payment method specific input.
 */
function enrichPaymentMethodSpecificInput(order, paymentInstrument, paymentMethodSpecificInput) {
    var enrichedInput;
    var cardInput;
    var mobileInput;
    var redirectInput;
    var cardholderName;
    var returnUrl;
    var sepaInput;
    var mandate;
    var creditorId;

    if (!paymentMethodSpecificInput) {
        return null;
    }

    if (!paymentMethodSpecificInput.cardPaymentMethodSpecificInput
        && !paymentMethodSpecificInput.sepaDirectDebitPaymentMethodSpecificInput
        && !paymentMethodSpecificInput.mobilePaymentMethodSpecificInput
        && !paymentMethodSpecificInput.redirectPaymentMethodSpecificInput) {
        return paymentMethodSpecificInput;
    }

    enrichedInput = JSON.parse(JSON.stringify(paymentMethodSpecificInput));
    if (enrichedInput.cardPaymentMethodSpecificInput) {
        cardInput = enrichedInput.cardPaymentMethodSpecificInput;
        cardholderName = getCardholderName(order);
        returnUrl = buildReturnUrl(order, paymentInstrument);

        if (!cardInput.transactionChannel) {
            cardInput.transactionChannel = 'ECOMMERCE';
        }

        if (returnUrl && !cardInput.returnUrl) {
            cardInput.returnUrl = returnUrl;
        }

        if (!cardInput.returnUrl) {
            LOGGER.error(
                'PAYONE card payment input for order {0} is missing returnUrl. Card 3DS redirect flow cannot continue safely.',
                order && order.orderNo ? order.orderNo : 'unknown'
            );
            return null;
        }

        if (cardholderName) {
            if (!cardInput.card) {
                cardInput.card = {};
            }

            if (!cardInput.card.cardholderName) {
                cardInput.card.cardholderName = cardholderName;
            }
        }
    }

    if (enrichedInput.sepaDirectDebitPaymentMethodSpecificInput) {
        sepaInput = enrichedInput.sepaDirectDebitPaymentMethodSpecificInput;
        mandate = sepaInput.paymentProduct771SpecificInput && sepaInput.paymentProduct771SpecificInput.mandate;
        creditorId = Site.current.getCustomPreferenceValue('payoneSepaCreditorId');

        if (!mandate || !mandate.bankAccountIban) {
            LOGGER.error(
                'PAYONE SEPA input for order {0} is missing bank-account mandate information.',
                order && order.orderNo ? order.orderNo : 'unknown'
            );
            return null;
        }

        if (!creditorId) {
            LOGGER.error(
                'PAYONE SEPA input for order {0} is missing site preference payoneSepaCreditorId.',
                order && order.orderNo ? order.orderNo : 'unknown'
            );
            return null;
        }

        if (!mandate.recurrenceType) {
            mandate.recurrenceType = 'UNIQUE';
        }

        if (!mandate.uniqueMandateReference) {
            mandate.uniqueMandateReference = payoneMerchantReferenceHelper.buildSepaMandateReference();
        }

        if (!mandate.dateOfSignature) {
            mandate.dateOfSignature = formatAsPayoneDate(new Date());
        }

        if (!mandate.creditorId) {
            mandate.creditorId = creditorId;
        }
    }

    if (enrichedInput.redirectPaymentMethodSpecificInput
        && enrichedInput.redirectPaymentMethodSpecificInput.paymentProductId === WERO_PAYMENT_PRODUCT_ID) {
        redirectInput = enrichedInput.redirectPaymentMethodSpecificInput;
        returnUrl = buildReturnUrl(order, paymentInstrument);
        redirectInput.redirectionData = redirectInput.redirectionData || {};

        if (returnUrl && !redirectInput.redirectionData.returnUrl) {
            redirectInput.redirectionData.returnUrl = returnUrl;
        }

        if (!redirectInput.redirectionData.returnUrl) {
            LOGGER.error(
                'PAYONE Wero payment input for order {0} is missing redirectionData.returnUrl.',
                order && order.orderNo ? order.orderNo : 'unknown'
            );
            return null;
        }
    }

    if (enrichedInput.mobilePaymentMethodSpecificInput
        && enrichedInput.mobilePaymentMethodSpecificInput.paymentProductId === 320) {
        mobileInput = enrichedInput.mobilePaymentMethodSpecificInput;
        returnUrl = buildReturnUrl(order, paymentInstrument);

        if (!mobileInput.authorizationMode) {
            mobileInput.authorizationMode = 'PRE_AUTHORIZATION';
        }

        if (!mobileInput.threeDSecure) {
            mobileInput.threeDSecure = {};
        }

        if (!mobileInput.threeDSecure.redirectionData) {
            mobileInput.threeDSecure.redirectionData = {};
        }

        if (returnUrl && !mobileInput.threeDSecure.redirectionData.returnUrl) {
            mobileInput.threeDSecure.redirectionData.returnUrl = returnUrl;
        }

        if (!mobileInput.threeDSecure.redirectionData.returnUrl) {
            LOGGER.error(
                'PAYONE Google Pay input for order {0} is missing threeDSecure.redirectionData.returnUrl.',
                order && order.orderNo ? order.orderNo : 'unknown'
            );
            return null;
        }
    }

    return enrichedInput;
}

/**
 * Builds the create-commerce-case request body for an SFCC order.
 *
 * @param {dw.order.Order|Object} order - Order source.
 * @param {dw.order.PaymentInstrument|Object} paymentInstrument - Payment instrument source.
 * @returns {Object} PAYONE create-commerce-case payload.
 */
function buildCreateRequestBody(order, paymentInstrument) {
    var orderNo = order && order.orderNo ? order.orderNo : null;
    var customerOverride = getCustomerDataOverride(paymentInstrument);
    var customerModel = Customer.fromOrder(order, customerOverride);
    var paymentMethodSpecificInput = enrichPaymentMethodSpecificInput(order, paymentInstrument, buildPaymentMethodSpecificInput(paymentInstrument));
    var hasPaymentMethodSpecificInput = paymentMethodSpecificInput && Object.keys(paymentMethodSpecificInput).length > 0;
    var customerDevice = buildCustomerDevice(order);
    var orderRequestData = {};
    var checkoutModel;
    var checkoutRequest;

    if (!payoneMerchantReferenceHelper.validateOrderReferences(orderNo, hasPaymentMethodSpecificInput)) {
        return null;
    }

    if (hasPaymentMethodSpecificInput) {
        orderRequestData.paymentMethodSpecificInput = paymentMethodSpecificInput;

        if (!orderRequestData.paymentMethodSpecificInput.customerDevice && customerDevice) {
            orderRequestData.paymentMethodSpecificInput.customerDevice = customerDevice;
        }
    }

    checkoutModel = CreateCheckoutRequest.fromOrder(
        order,
        new OrderRequest(orderRequestData),
        hasPaymentMethodSpecificInput
    );
    checkoutRequest = checkoutModel.toRequest();

    if (!hasPaymentMethodSpecificInput) {
        delete checkoutRequest.orderRequest;
    } else {
        checkoutRequest.orderRequest.orderReferences = checkoutRequest.orderRequest.orderReferences || {};
        checkoutRequest.orderRequest.orderReferences.merchantReference = payoneMerchantReferenceHelper.buildPaymentReference(orderNo);
    }

    checkoutRequest.references = checkoutRequest.references || {};
    checkoutRequest.references.merchantReference = payoneMerchantReferenceHelper.buildCheckoutReference(orderNo);

    return {
        merchantReference: payoneMerchantReferenceHelper.buildCommerceCaseReference(orderNo),
        customer: customerModel.toRequest(),
        checkout: checkoutRequest
    };
}

/**
 * Builds the PAYONE order payload for completing a secured installment payment execution.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {Object} context - Stored secured installment context.
 * @param {Object|null} customerOverride - Checkout-specific customer override data.
 * @returns {Object|null} PAYONE order payload for complete-payment.
 */
function buildSecureInstallmentCompletePaymentOrder(order, context, customerOverride) {
    var checkoutOrderData;
    var references;

    checkoutOrderData = CreateCheckoutRequest.fromOrder(order, new OrderRequest({
        paymentMethodSpecificInput: null
    })).toOrderUpdate();

    references = {
        merchantReference: payoneMerchantReferenceHelper.buildPaymentReference(order && order.orderNo)
    };

    return {
        amountOfMoney: checkoutOrderData.amountOfMoney || null,
        customer: Customer.fromOrder(order, customerOverride).toRequest(),
        references: references,
        shipping: checkoutOrderData.shipping || null,
        shoppingCart: checkoutOrderData.shoppingCart || null
    };
}

/**
 * Extracts the most useful payment execution identifier from a PAYONE create response.
 *
 * @param {Object} createResult - Normalized PAYONE create response.
 * @param {string} fallbackTransactionId - Fallback transaction ID.
 * @returns {string|null} Transaction identifier to save on the payment transaction.
 */
function getTransactionId(createResult, fallbackTransactionId) {
    var checkout = createResult && createResult.data ? createResult.data.checkout : null;

    if (checkout && checkout.paymentExecution && checkout.paymentExecution.paymentExecutionId) {
        return checkout.paymentExecution.paymentExecutionId;
    }

    if (checkout && checkout.paymentResponse && checkout.paymentResponse.paymentExecutionId) {
        return checkout.paymentResponse.paymentExecutionId;
    }

    if (createResult && createResult.data && createResult.data.commerceCaseId) {
        return createResult.data.commerceCaseId;
    }

    return fallbackTransactionId || null;
}

/**
 * Resolves a user-facing error message from a successful HTTP response that still contains a PAYONE payment rejection.
 *
 * @param {Object} createResult - Normalized PAYONE create response.
 * @returns {string|null} Error message when present.
 */
function getCreateResponseErrorMessage(createResult) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);
    var errorResponse = checkout && checkout.errorResponse;
    var errors = errorResponse && errorResponse.errors;
    var firstError = errors && errors.length ? errors[0] : null;

    if (!firstError) {
        return null;
    }

    return firstError.message || firstError.id || Resource.msg('error.technical', 'checkout', null);
}

/**
 * Determines whether the PAYONE create response contains a rejected payment outcome.
 *
 * @param {Object} createResult - Normalized PAYONE create response.
 * @returns {boolean} True when the payment was rejected.
 */
function hasRejectedPayment(createResult) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);

    return payoneCheckoutStateHelper.isRejected(checkout);
}

/**
 * Extracts checkout-only identifiers from a PAYONE create response for Store Pay.
 *
 * @param {Object} createResult - Normalized PAYONE create response.
 * @returns {{commerceCaseId:string, merchantReference:(string|null), checkoutId:string, paymentExecutionId:null, checkoutPaymentStatus:(string|null), latestPaymentEventStatus:null, redirectUrl:null}|null} Identifier bundle.
 */
function getStorePayIdentifierData(createResult) {
    var checkout = payoneCheckoutStateHelper.getCheckout(createResult);

    if (!(createResult && createResult.data && createResult.data.commerceCaseId && checkout && checkout.checkoutId)) {
        return null;
    }

    return {
        commerceCaseId: createResult.data.commerceCaseId,
        merchantReference: checkout && checkout.references ? checkout.references.merchantReference || null : null,
        checkoutId: checkout.checkoutId,
        paymentExecutionId: null,
        checkoutPaymentStatus: payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout),
        latestPaymentEventStatus: null,
        redirectUrl: null
    };
}

/**
 * Saves the payment processor, transaction id, and PAYONE identifiers atomically.
 *
 * @param {dw.order.PaymentInstrument} paymentInstrument - Payment instrument to update.
 * @param {dw.order.PaymentProcessor} paymentProcessor - Payment processor to set.
 * @param {string} transactionId - Transaction ID to save.
 * @param {Object} identifierData - PAYONE identifier bundle to save.
 * @returns {boolean} True when the authorization data was saved successfully.
 */
function persistAuthorizationData(paymentInstrument, paymentProcessor, transactionId, identifierData) {
    return payonePaymentTransactionSaver.saveAuthorizationOnPaymentTransaction(
        paymentInstrument && paymentInstrument.paymentTransaction,
        paymentProcessor,
        transactionId,
        identifierData
    );
}

/**
 * Persists the merchant reference value to the custom attribute of the given order.
 *
 * @param {dw.order.Order} order - The order object to update with the merchant reference.
 * @returns {boolean} Returns true if the merchant reference was successfully persisted, false otherwise.
 */
function persistMerchantReference(order) {
    var orderMerchantReference;

    if (!order || !order.custom) {
        return false;
    }

    orderMerchantReference = payoneMerchantReferenceHelper.buildPaymentReference(order.orderNo);

    if (!orderMerchantReference) {
        return false;
    }

    try {
        Transaction.wrap(function () {
            order.custom.payoneMerchantReference = orderMerchantReference || null;
        })
    } catch (e) {
        LOGGER.error(
            'PAYONE merchant reference could not be saved on the order. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
        return false;
    }

    return true;
}

/**
 * Builds the PAYONE identifier bundle for a completed Secure Installment authorization.
 *
 * @param {Object} context - Stored Secure Installment context.
 * @param {Object} completeResult - Complete payment result.
 * @returns {{commerceCaseId:(string|null), merchantReference:(string|null), checkoutId:(string|null), paymentExecutionId:(string|null), checkoutPaymentStatus:(string|null), latestPaymentEventStatus:(string|null), redirectUrl:null}} Identifier bundle.
 */
function buildSecureInstallmentIdentifierData(context, completeResult) {
    var latestPaymentEventStatus = null;

    if (completeResult && completeResult.data && completeResult.data.payment) {
        latestPaymentEventStatus = completeResult.data.payment.status;
    } else if (context && context.latestPaymentEventStatus) {
        latestPaymentEventStatus = context.latestPaymentEventStatus;
    }

    return {
        commerceCaseId: context && context.commerceCaseId ? context.commerceCaseId : null,
        merchantReference: context && context.merchantReference ? context.merchantReference : null,
        checkoutId: context && context.checkoutId ? context.checkoutId : null,
        paymentExecutionId: context && context.paymentExecutionId ? context.paymentExecutionId : null,
        checkoutPaymentStatus: context && context.checkoutPaymentStatus ? context.checkoutPaymentStatus : null,
        latestPaymentEventStatus: latestPaymentEventStatus,
        redirectUrl: null
    };
}

/**
 * Persists PAYONE identifiers for a pre-authorized checkout attempt before returning a failed SFCC authorization.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {dw.order.PaymentProcessor} paymentProcessor - SFCC payment processor.
 * @param {Object} identifierData - PAYONE identifier bundle to save.
 * @param {string} paymentMethodName - Payment method name for backend logs.
 * @returns {boolean} True when the attempt data was saved.
 */
function persistPreAuthorizationAttemptData(order, paymentInstrument, paymentProcessor, identifierData, paymentMethodName) {
    var transactionId = identifierData && identifierData.paymentExecutionId
        ? identifierData.paymentExecutionId
        : (order && order.orderNo) || null;
    var saved;

    if (!(identifierData && identifierData.commerceCaseId && identifierData.checkoutId)) {
        return false;
    }

    saved = persistAuthorizationData(paymentInstrument, paymentProcessor, transactionId, identifierData)
        && persistMerchantReference(order);

    if (!saved) {
        LOGGER.error(
            'PAYONE {0} attempt data could not be saved on failed order {1}. commerceCaseId: {2}, checkoutId: {3}, paymentExecutionId: {4}.',
            paymentMethodName || 'checkout',
            order && order.orderNo ? order.orderNo : 'unknown',
            identifierData && identifierData.commerceCaseId ? identifierData.commerceCaseId : 'unknown',
            identifierData && identifierData.checkoutId ? identifierData.checkoutId : 'unknown',
            identifierData && identifierData.paymentExecutionId ? identifierData.paymentExecutionId : 'unknown'
        );
    }

    return saved;
}

/**
 * Builds the PAYONE identifier bundle for a completed PayPal authorization.
 *
 * @param {Object} context - Approved PayPal context.
 * @param {Object|null} checkout - Latest PAYONE checkout state, when available.
 * @returns {{commerceCaseId:(string|null), merchantReference:(string|null), checkoutId:(string|null), paymentExecutionId:(string|null), checkoutPaymentStatus:(string|null), latestPaymentEventStatus:(string|null), redirectUrl:null}} Identifier bundle.
 */
function buildPayPalIdentifierData(context, checkout) {
    return {
        commerceCaseId: context && context.commerceCaseId ? context.commerceCaseId : null,
        merchantReference: context && context.merchantReference ? context.merchantReference : null,
        checkoutId: context && context.checkoutId ? context.checkoutId : null,
        paymentExecutionId: context && context.paymentExecutionId ? context.paymentExecutionId : null,
        checkoutPaymentStatus: payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout)
            || (context && context.checkoutPaymentStatus ? context.checkoutPaymentStatus : null),
        latestPaymentEventStatus: payoneCheckoutStateHelper.getLatestPaymentEventStatus(
            checkout,
            context && context.paymentExecutionId ? context.paymentExecutionId : null
        ) || (context && context.latestPaymentEventStatus ? context.latestPaymentEventStatus : null),
        redirectUrl: null
    };
}

/**
 * Clears transient checkout payloads that should not remain on the order payment instrument
 * after the required PAYONE identifiers have been persisted.
 *
 * @param {dw.order.PaymentInstrument} paymentInstrument - Payment instrument to update.
 * @returns {boolean} True when the cleanup finished without throwing.
 */
function clearTransientCheckoutData(paymentInstrument) {
    if (!paymentInstrument || !paymentInstrument.custom) {
        return false;
    }

    try {
        Transaction.wrap(function () {
            paymentInstrument.custom.payonePaymentMethodSpecificInput = null;
            paymentInstrument.custom.payoneCustomerDataOverride = null;
            paymentInstrument.custom.payonePayPalPaymentContext = null;
            paymentInstrument.custom.payoneSecureInstallmentContext = null;
        });
    } catch (e) {
        LOGGER.error(
            'PAYONE transient checkout data could not be cleared from the order payment instrument. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
        return false;
    }

    return true;
}

/**
 * Builds a failed authorization result after removing transient checkout data
 * that should not remain visible on failed order payment instruments.
 *
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {string} errorMessage - User-facing error message.
 * @param {Object|null} createResult - PAYONE service result, when available.
 * @returns {{error:boolean, errorMessage:string, createResult:(Object|null)}} Authorization failure result.
 */
function buildAuthorizationFailure(paymentInstrument, errorMessage, createResult) {
    clearTransientCheckoutData(paymentInstrument);
    payoneCard3DSHelper.clearRedirectState(paymentInstrument && paymentInstrument.paymentTransaction);

    return {
        error: true,
        errorMessage: errorMessage,
        createResult: createResult || null
    };
}

/**
 * Fails Secure Installment authorization after preserving any existing PAYONE attempt identifiers.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {dw.order.PaymentProcessor} paymentProcessor - SFCC payment processor.
 * @param {Object|null} context - Stored Secure Installment context.
 * @param {Object|null} completeResult - Complete payment result, when available.
 * @param {string} errorMessage - User-facing error message.
 * @returns {{error:boolean, errorMessage:string, createResult:(Object|null)}} Authorization failure result.
 */
function failSecureInstallmentAuthorization(order, paymentInstrument, paymentProcessor, context, completeResult, errorMessage) {
    persistPreAuthorizationAttemptData(
        order,
        paymentInstrument,
        paymentProcessor,
        buildSecureInstallmentIdentifierData(context, completeResult),
        'Secure Installment'
    );

    return buildAuthorizationFailure(paymentInstrument, errorMessage, completeResult);
}

/**
 * Fails PayPal authorization after preserving any existing PAYONE attempt identifiers.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {dw.order.PaymentProcessor} paymentProcessor - SFCC payment processor.
 * @param {Object|null} context - Stored PayPal context.
 * @param {Object|null} checkout - Latest PAYONE checkout state, when available.
 * @param {Object|null} getResult - PAYONE get-commerce-case result, when available.
 * @param {string} errorMessage - User-facing error message.
 * @returns {{error:boolean, errorMessage:string, createResult:(Object|null)}} Authorization failure result.
 */
function failPayPalAuthorization(order, paymentInstrument, paymentProcessor, context, checkout, getResult, errorMessage) {
    persistPreAuthorizationAttemptData(
        order,
        paymentInstrument,
        paymentProcessor,
        buildPayPalIdentifierData(context, checkout),
        'PayPal'
    );

    return buildAuthorizationFailure(paymentInstrument, errorMessage, getResult);
}

/**
 * Finalizes an already created PAYONE Secure Installment checkout for the created SFCC order.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {dw.order.PaymentProcessor} paymentProcessor - SFCC payment processor.
 * @returns {{error:boolean, errorMessage:(string|null), createResult:(Object|null)}} Authorization result.
 */
function authorizeSecureInstallment(order, paymentInstrument, paymentProcessor) {
    var context = getSecureInstallmentContext(paymentInstrument);
    var paymentInput = buildPaymentMethodSpecificInput(paymentInstrument);
    var customerOverride = getCustomerDataOverride(paymentInstrument);
    var financingInput = paymentInput && paymentInput.financingPaymentMethodSpecificInput;
    var completeInput = financingInput && financingInput.paymentProduct3391SpecificInput;
    var isAuthorized;
    var completePaymentOrder;
    var customerDevice;
    var completeResult;
    var transactionId;
    var savedIdentifierData;

    if (
        !context
        || !context.paymentExecutionId
        || !completeInput
        || !completeInput.installmentOptionId
        || !completeInput.bankAccountInformation
        || !payoneSecureInstallmentHelper.isContextValidForOrder(context, order, customerOverride)
        || !payoneSecureInstallmentHelper.hasInstallmentOption(context, completeInput.installmentOptionId)
    ) {
        return failSecureInstallmentAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            null,
            Resource.msg('error.payment.not.valid', 'checkout', null)
        );
    }

    if (!payoneSecureInstallmentHelper.hasMatchingBillingAndShippingAddress(order, null)) {
        return failSecureInstallmentAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            null,
            Resource.msg('payone.error.secure_installment_address_mismatch', 'payoneError', null)
        );
    }

    completePaymentOrder = buildSecureInstallmentCompletePaymentOrder(order, context, customerOverride);
    customerDevice = buildCustomerDevice(order);

    completeResult = paymentExecutionService.complete({
        commerceCaseId: context.commerceCaseId,
        checkoutId: context.checkoutId,
        paymentExecutionId: context.paymentExecutionId,
        body: new CompletePaymentRequest({
            financingPaymentMethodSpecificInput: {
                paymentProductId: payoneSecureInstallmentHelper.PAYMENT_PRODUCT_ID,
                requiresApproval: true,
                paymentProduct3391SpecificInput: completeInput
            },
            order: completePaymentOrder,
            device: customerDevice
        }).toRequest()
    });

    savedIdentifierData = buildSecureInstallmentIdentifierData(context, completeResult);

    if (!completeResult.ok) {
        return failSecureInstallmentAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            completeResult,
            completeResult.userMessage || Resource.msg('error.technical', 'checkout', null)
        );
    }

    isAuthorized = completeResult.data
        && completeResult.data.payment
        && completeResult.data.payment.statusOutput
        && completeResult.data.payment.statusOutput.isAuthorized === true;

    if (!isAuthorized) {
        return failSecureInstallmentAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            completeResult,
            Resource.msg('error.payment.not.valid', 'checkout', null)
        );
    }

    transactionId = context.paymentExecutionId || (order && order.orderNo) || null;

    if (
        !persistAuthorizationData(paymentInstrument, paymentProcessor, transactionId, savedIdentifierData)
        || !persistMerchantReference(order)
    ) {
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.technical', 'checkout', null),
            completeResult
        );
    }

    clearTransientCheckoutData(paymentInstrument);

    return {
        error: false,
        errorMessage: null,
        createResult: completeResult
    };
}

/**
 * Finalizes an already approved PAYONE PayPal payment for the created SFCC order.
 *
 * @param {dw.order.Order|Object} order - Created SFCC order.
 * @param {dw.order.PaymentInstrument} paymentInstrument - Order payment instrument.
 * @param {dw.order.PaymentProcessor} paymentProcessor - SFCC payment processor.
 * @returns {{error:boolean, errorMessage:(string|null), createResult:(Object|null)}} Authorization result.
 */
function authorizeApprovedPayPal(order, paymentInstrument, paymentProcessor) {
    var context = getPayPalPaymentContext(paymentInstrument);
    var checkoutStateResult;
    var getResult;
    var checkout;
    var transactionId;
    var savedIdentifierData;

    if (
        !context
        || !context.approved
        || !context.completed
        || !payonePayPalHelper.isContextValidForOrder(context, order)
    ) {
        return failPayPalAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            null,
            null,
            Resource.msg('error.payment.not.valid', 'checkout', null)
        );
    }

    checkoutStateResult = payonePayPalHelper.getCheckoutState(
        context.commerceCaseId,
        context.checkoutId
    ) || {};
    getResult = checkoutStateResult.getResult;
    checkout = checkoutStateResult.checkout;

    if (!(getResult && getResult.ok) || !checkout) {
        return failPayPalAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            checkout,
            getResult,
            (getResult && getResult.userMessage) || Resource.msg('error.technical', 'checkout', null)
        );
    }

    if (
        payoneCheckoutStateHelper.isRejected(checkout, context.paymentExecutionId)
        || !payoneCheckoutStateHelper.isSuccessfulPostRedirectState(checkout, context.paymentExecutionId)
    ) {
        return failPayPalAuthorization(
            order,
            paymentInstrument,
            paymentProcessor,
            context,
            checkout,
            getResult,
            Resource.msg('error.payment.not.valid', 'checkout', null)
        );
    }

    context.checkoutPaymentStatus = payoneCheckoutStateHelper.getCheckoutPaymentStatus(checkout) || context.checkoutPaymentStatus;
    context.latestPaymentEventStatus = payoneCheckoutStateHelper.getLatestPaymentEventStatus(checkout, context.paymentExecutionId)
        || context.latestPaymentEventStatus;

    transactionId = context.paymentExecutionId || context.payPalTransactionId || (order && order.orderNo);
    savedIdentifierData = buildPayPalIdentifierData(context, checkout);

    if (
        !persistAuthorizationData(paymentInstrument, paymentProcessor, transactionId, savedIdentifierData)
        || !persistMerchantReference(order)
    ) {
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.technical', 'checkout', null),
            getResult
        );
    }

    clearTransientCheckoutData(paymentInstrument);

    return {
        error: false,
        errorMessage: null,
        createResult: getResult
    };
}

/**
 * Executes PAYONE authorization for the current order.
 * Depending on the selected method, this either creates a new commerce case,
 * finalizes an existing approved checkout, or completes an existing payment execution.
 *
 * @param {Object} params - Authorization parameters.
 * @param {string} params.orderNumber - SFCC order number.
 * @param {dw.order.PaymentInstrument} params.paymentInstrument - SFCC payment instrument.
 * @param {dw.order.PaymentProcessor} params.paymentProcessor - SFCC payment processor.
 * @returns {{error:boolean, errorMessage:(string|null), createResult:(Object|null)}} Authorization result.
 */
function authorize(params) {
    var safeParams = params || {};
    var orderNumber = safeParams.orderNumber;
    var paymentInstrument = safeParams.paymentInstrument;
    var paymentProcessor = safeParams.paymentProcessor;
    var order = OrderMgr.getOrder(orderNumber);
    var isStorePay;
    var createRequestBody;
    var createResult;
    var savedIdentifierData;
    var transactionId;

    if (!order) {
        return {
            error: true,
            errorMessage: Resource.msg('error.technical', 'checkout', null),
            createResult: null
        };
    }

    if (paymentInstrument && paymentInstrument.paymentMethod === payonePayPalHelper.PAYMENT_METHOD_ID) {
        return authorizeApprovedPayPal(order, paymentInstrument, paymentProcessor);
    }

    if (paymentInstrument && paymentInstrument.paymentMethod === payoneSecureInstallmentHelper.PAYMENT_METHOD_ID) {
        return authorizeSecureInstallment(order, paymentInstrument, paymentProcessor);
    }

    if (!buildPaymentMethodSpecificInput(paymentInstrument)) {
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.payment.not.valid', 'checkout', null),
            null
        );
    }

    isStorePay = paymentInstrument && paymentInstrument.paymentMethod === STORE_PAY_PAYMENT_METHOD_ID;
    createRequestBody = buildCreateRequestBody(order, paymentInstrument);

    if (!createRequestBody || !createRequestBody.checkout
        || (
            !isStorePay
            && (
                !createRequestBody.checkout.orderRequest
                || !createRequestBody.checkout.orderRequest.paymentMethodSpecificInput
            )
        )) {
        LOGGER.error(
            'PAYONE authorization aborted for order {0} because the request body could not be built safely for the selected payment method.',
            orderNumber
        );
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.technical', 'checkout', null),
            null
        );
    }

    createResult = commerceCaseService.create({
        body: createRequestBody
    });

    if (!createResult.ok) {
        return buildAuthorizationFailure(
            paymentInstrument,
            createResult.userMessage || Resource.msg('error.technical', 'checkout', null),
            createResult
        );
    }

    transactionId = getTransactionId(createResult, orderNumber);
    savedIdentifierData = isStorePay
        ? getStorePayIdentifierData(createResult)
        : payonePaymentTransactionSaver.extractIdentifiersFromCreateResult(createResult);

    if (savedIdentifierData && (
        !persistAuthorizationData(paymentInstrument, paymentProcessor, transactionId, savedIdentifierData)
        || !persistMerchantReference(order)
    )) {
        LOGGER.error(
            'PAYONE authorization for order {0} created a commerce case but the payment transaction data could not be saved atomically.',
            orderNumber
        );
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.technical', 'checkout', null),
            createResult
        );
    }

    // PAYONE can return HTTP OK with a rejected payment. Keep the failed order traceable in BM.
    if (hasRejectedPayment(createResult)) {
        clearTransientCheckoutData(paymentInstrument);
        payoneCard3DSHelper.clearRedirectState(paymentInstrument && paymentInstrument.paymentTransaction);

        return {
            error: true,
            errorMessage: getCreateResponseErrorMessage(createResult),
            createResult: createResult
        };
    }

    if (!savedIdentifierData) {
        LOGGER.error(
            'PAYONE authorization for order {0} created a commerce case but no PAYONE identifiers could be extracted.',
            orderNumber
        );
        return buildAuthorizationFailure(
            paymentInstrument,
            Resource.msg('error.technical', 'checkout', null),
            createResult
        );
    }

    if (isStorePay && savedIdentifierData.paymentExecutionId) {
        LOGGER.error(
            'PAYONE Store Pay authorization for order {0} unexpectedly returned paymentExecutionId {1} although no payment execution should have been created.',
            orderNumber,
            savedIdentifierData.paymentExecutionId
        );
    }

    clearTransientCheckoutData(paymentInstrument);

    return {
        error: false,
        errorMessage: null,
        createResult: createResult
    };
}

module.exports = {
    authorize: authorize,
    buildCreateRequestBody: buildCreateRequestBody,
    buildPaymentMethodSpecificInput: buildPaymentMethodSpecificInput,
    buildReturnUrl: buildReturnUrl,
    enrichPaymentMethodSpecificInput: enrichPaymentMethodSpecificInput,
    ensurePostRedirectReturnNonce: ensurePostRedirectReturnNonce
};
