'use strict';

var server = require('server');
var BasketMgr = require('dw/order/BasketMgr');
var Logger = require('dw/system/Logger');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var consentTracking = require('*/cartridge/scripts/middleware/consentTracking');
var OrderModel = require('*/cartridge/models/order');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var payoneSdkToken = require('*/cartridge/scripts/services/payoneSdkToken');
var commerceCaseService = require('*/cartridge/scripts/services/commerceCaseService');
var orderManagementCheckoutActionsService = require('*/cartridge/scripts/services/orderManagementCheckoutActionsService');
var payoneCheckoutStateHelper = require('*/cartridge/scripts/payone/payoneCheckoutStateHelper');
var payoneCommercePaymentForm = require('*/cartridge/scripts/middleware/payoneCommerce');
var payonePayPalHelper = require('*/cartridge/scripts/payone/payonePayPalHelper');
var payoneCheckoutRefreshHelper = require('*/cartridge/scripts/payone/payoneCheckoutRefreshHelper');
var payoneSecureInstallmentHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentHelper');
var payoneSecureInstallmentCheckoutHelper = require('*/cartridge/scripts/payone/payoneSecureInstallmentCheckoutHelper');
var payonePostRedirectOrderHelper = require('*/cartridge/scripts/payone/payonePostRedirectOrderHelper');
var payoneReservedOrderNoHelper = require('*/cartridge/scripts/payone/payoneReservedOrderNoHelper');
var payoneMerchantReferenceHelper = require('*/cartridge/scripts/payone/payoneMerchantReferenceHelper');
var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');
var CompleteOrderRequest = require('*/cartridge/scripts/models/payone/CompleteOrderRequest');
var CancelCheckoutRequest = require('*/cartridge/scripts/models/payone/CancelCheckoutRequest');
var webhookUtils = require('*/cartridge/scripts/helpers/payoneWebhookUtils');

var LOGGER = Logger.getLogger('payone', 'payoneCommerce');

/**
 * Logs non-OK PAYONE checkout cancel results without failing the current flow.
 *
 * @param {Object} cancelResult - Normalized cancel service result.
 * @param {string} operationName - Functional context for the cancel attempt.
 * @param {string} commerceCaseId - PAYONE commerce case identifier.
 * @param {string} checkoutId - PAYONE checkout identifier.
 * @returns {void}
 */
function logCheckoutCancelFailure(cancelResult, operationName, commerceCaseId, checkoutId) {
    if (cancelResult && cancelResult.ok === false) {
        LOGGER.warn(
            'PAYONE checkout cancel returned non-OK during {0}. commerceCaseId: {1}, checkoutId: {2}, userMessage: {3}.',
            operationName || 'unknown',
            commerceCaseId || 'unknown',
            checkoutId || 'unknown',
            cancelResult.userMessage || 'unknown'
        );
    }
}

/**
 * Cancels a stored PAYONE PayPal checkout context when the checkout is still cancellable.
 *
 * @param {Object|null} context - Stored PayPal context.
 * @param {string} operationName - Functional context for logging.
 * @returns {boolean} True when a context was processed.
 */
function cancelPayPalContext(context, operationName) {
    var cancelRequest;
    var checkoutState;
    var checkout;
    var cancelResult;

    if (!context || !context.commerceCaseId || !context.checkoutId) {
        return false;
    }

    checkoutState = payonePayPalHelper.getCheckoutState(context.commerceCaseId, context.checkoutId);
    checkout = checkoutState && checkoutState.checkout;

    if (checkoutState && checkoutState.getResult && checkoutState.getResult.ok && payoneCheckoutStateHelper.canCancelCheckout(checkout)) {
        cancelRequest = new CancelCheckoutRequest({
            cancelType: 'FULL',
            cancellationReason: 'CONSUMER_REQUEST'
        });

        cancelResult = orderManagementCheckoutActionsService.cancel({
            commerceCaseId: context.commerceCaseId,
            checkoutId: context.checkoutId,
            body: cancelRequest.toRequest()
        });
        logCheckoutCancelFailure(
            cancelResult,
            operationName,
            context.commerceCaseId,
            context.checkoutId
        );
        return true;
    }

    if (checkoutState && checkoutState.getResult && checkoutState.getResult.ok) {
        LOGGER.info(
            'Skipping PAYONE PayPal cancel during {0} because checkout status {1} is not cancellable. commerceCaseId: {2}, checkoutId: {3}.',
            operationName || 'unknown',
            checkout && checkout.checkoutStatus ? checkout.checkoutStatus : 'unknown',
            context.commerceCaseId,
            context.checkoutId
        );
        return true;
    }

    LOGGER.warn(
        'Unable to load latest PAYONE PayPal checkout state before {0}. commerceCaseId: {1}, checkoutId: {2}, userMessage: {3}.',
        operationName || 'cancel',
        context.commerceCaseId,
        context.checkoutId,
        checkoutState && checkoutState.getResult && checkoutState.getResult.userMessage
            ? checkoutState.getResult.userMessage
            : 'unknown'
    );
    return true;
}

/**
 * Returns the shopper to a fresh payment step after a stale PayPal approval failure.
 *
 * @param {Object} req - Current request.
 * @param {Object} res - Current response.
 * @param {string} message - User-facing error message.
 * @returns {void}
 */
function sendPayPalApprovalRefreshError(req, res, message) {
    payoneCheckoutRefreshHelper.storeCheckoutReturnError(req, message);

    res.json({
        error: true,
        message: message,
        redirectUrl: payoneCheckoutRefreshHelper.getPaymentStageUrl()
    });
}

/**
 * Builds the same billing view data shape used by SFRA Checkout-Begin.
 *
 * @param {dw.order.Basket} currentBasket - Current basket.
 * @param {Object} req - Current request.
 * @returns {Object} View data for the PAYONE payment options partial.
 */
function getPaymentOptionsViewData(currentBasket, req) {
    var payoneCommerceApplePayHelper = require('*/cartridge/scripts/helpers/payoneCommerceApplePayHelper.js');

    var currentCustomer = req.currentCustomer.raw;
    var usingMultiShipping = req.session.privacyCache.get('usingMultiShipping');
    var allValid = COHelpers.ensureValidShipments(currentBasket);

    var billingAddress = currentBasket.billingAddress;
    var firstShipment = currentBasket && currentBasket.shipments && currentBasket.shipments.length && currentBasket.shipments[0];
    var shippingAddress = firstShipment && firstShipment.shippingAddress;
    var addressForCountry = billingAddress || shippingAddress;
    var countryCode = addressForCountry && addressForCountry.countryCode ? addressForCountry.countryCode.value : null;

    var orderModel = new OrderModel(currentBasket, {
        customer: currentCustomer,
        usingMultiShipping: usingMultiShipping,
        shippable: allValid,
        countryCode: countryCode,
        containerView: 'basket'
    });

    // hide Apple Pay payment option if it's not an Apple Pay session
    orderModel.billing.payment.applicablePaymentMethods = orderModel.billing.payment.applicablePaymentMethods.filter(function (method) {
        if (method.ID === payoneCommerceApplePayHelper.PAYMENT_METHOD_ID && !session.custom.applepay) {
            return false;
        }
        return true;
    });

    return {
        order: orderModel,
        forms: {
            billingForm: COHelpers.prepareBillingForm()
        }
    };
}

server.get('Token', function (req, res, next) {

    var getResult =  payoneSdkToken.get({});

    res.json({
        getResult: getResult
    });
    return next();
});

server.get('CheckoutData', function (req, res, next) {
    var payoneCommerceCheckoutHelper = require('*/cartridge/scripts/helpers/payoneCommerceCheckoutHelper');

    res.json(payoneCommerceCheckoutHelper.getPayoneCheckoutData());
    return next();
});

server.get('PaymentOptions', function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();

    if (!currentBasket) {
        res.render('checkout/billing/payoneCheckoutPaymentOptions', {
            forms: {
                billingForm: COHelpers.prepareBillingForm()
            },
            order: {
                billing: {
                    payment: {
                        applicablePaymentMethods: []
                    }
                }
            }
        });
        return next();
    }

    res.setViewData(getPaymentOptionsViewData(currentBasket, req));
    payoneCommercePaymentForm.initializeForms(req, res, function () {});
    res.render('checkout/billing/payoneCheckoutPaymentOptions', res.getViewData());
    return next();
});

server.post(
    'PaypalOrder',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var basket = payonePayPalHelper.getCurrentBasket();
        var previousContextKey = PayoneCommonUtils.trimString(req.form.previousContextKey, true);
        var previousContext;
        var reservedOrderNo;
        var requestBody;
        var createResult;
        var context;

        if (!basket) {
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        reservedOrderNo = payoneReservedOrderNoHelper.reserveFreshOrderNo();
        if (!reservedOrderNo) {
            LOGGER.error('PAYONE PayPal checkout creation aborted because an SFCC order number could not be reserved.');
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        if (!payoneMerchantReferenceHelper.validateOrderReferences(reservedOrderNo, true)) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        requestBody = payonePayPalHelper.buildCreateRequestBodyFromBasket(basket, reservedOrderNo);
        createResult = commerceCaseService.create({
            body: requestBody
        });

        if (!createResult.ok || payoneCheckoutStateHelper.isRejected(payoneCheckoutStateHelper.getCheckout(createResult))) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: createResult.userMessage || Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        context = payonePayPalHelper.storeCreateContext(req, basket, createResult, reservedOrderNo);

        if (!context) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        if (previousContextKey && previousContextKey !== context.contextKey) {
            previousContext = payonePayPalHelper.getContext(req, previousContextKey);

            cancelPayPalContext(previousContext, 'paypal context replacement');
            payonePayPalHelper.clearContext(req, previousContextKey);
        }

        res.json({
            error: false,
            contextKey: context.contextKey,
            payPalTransactionId: context.payPalTransactionId
        });
        return next();
    }
);

server.post(
    'PaypalApprove',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var contextKey = req.form.contextKey;
        var basket = payonePayPalHelper.getCurrentBasket();
        var context = payonePayPalHelper.getContext(req, contextKey);
        var completeResult;
        var completeRequest;

        if (!basket || !context || !payonePayPalHelper.isContextValidForBasket(context, basket)) {
            cancelPayPalContext(context, 'stale paypal approval cleanup');
            if (contextKey) {
                payonePayPalHelper.clearContext(req, contextKey);
            }
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            sendPayPalApprovalRefreshError(req, res, Resource.msg('error.payment.not.valid', 'checkout', null));
            return next();
        }

        completeRequest = new CompleteOrderRequest({
            completePaymentMethodSpecificInput: {
                paymentProduct840SpecificInput: {
                    javaScriptSdkFlow: true,
                    action: 'CONFIRM_ORDER_STATUS'
                }
            }
        });

        completeResult = orderManagementCheckoutActionsService.completeOrder({
            commerceCaseId: context.commerceCaseId,
            checkoutId: context.checkoutId,
            body: completeRequest.toRequest()
        });

        if (!completeResult.ok) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            sendPayPalApprovalRefreshError(req, res, completeResult.userMessage || Resource.msg('error.technical', 'checkout', null));
            return next();
        }

        context.approved = true;
        context.completed = true;
        payonePayPalHelper.saveContext(req, context);

        res.json({
            error: false,
            approved: true,
            contextKey: context.contextKey
        });
        return next();
    }
);

server.post(
    'PaypalCancel',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var contextKey = req.form.contextKey;
        var context = payonePayPalHelper.getContext(req, contextKey);

        cancelPayPalContext(context, 'paypal explicit cancel');
        if (contextKey) {
            payonePayPalHelper.clearContext(req, contextKey);
        }
        payoneReservedOrderNoHelper.clearReservedOrderNo();

        res.json({});
        return next();
    }
);

server.post(
    'SecureInstallmentOptions',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var basket = payoneSecureInstallmentHelper.getCurrentBasket();
        var previousContextKey = req.form.contextKey;
        var previousContext = payoneSecureInstallmentHelper.getContext(req, previousContextKey);
        var secureInstallmentFieldErrors = payoneSecureInstallmentCheckoutHelper.getFieldErrors(req);
        var customerOverride;
        var reservedOrderNo;
        var requestBody;
        var createResult;
        var context;
        var customerDevice;
        var checkout;
        var createCommerceCaseId;
        var createCheckoutId;
        var installmentOptions;
        var cancelResult;
        var previousCheckoutState;
        var previousCheckout;

        if (!basket) {
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        if (Object.keys(secureInstallmentFieldErrors).length) {
            res.json({
                error: true,
                fieldErrors: secureInstallmentFieldErrors,
                message: Resource.msg('error.payment.not.valid', 'checkout', null)
            });
            return next();
        }

        customerOverride = payoneSecureInstallmentCheckoutHelper.buildCustomerOverride(req);
        customerDevice = payoneSecureInstallmentCheckoutHelper.buildCustomerDevice(req);

        if (!customerOverride
        || !customerOverride.billingAddress
        || !customerOverride.billingAddress.street
        || !customerOverride.billingAddress.city
        || !customerOverride.billingAddress.zip
        || !customerOverride.billingAddress.countryCode
        || !customerOverride.personalInformation
        || !customerOverride.personalInformation.name
        || !customerOverride.personalInformation.name.firstName
        || !customerOverride.personalInformation.name.surname
        || !customerOverride.personalInformation.dateOfBirth
        || !customerOverride.contactDetails
        || !customerOverride.contactDetails.phoneNumber
        || !payoneSecureInstallmentCheckoutHelper.getEffectiveEmail(basket, customerOverride)
        ) {
            res.json({
                error: true,
                message: Resource.msg('error.payment.not.valid', 'checkout', null)
            });
            return next();
        }

        if (!customerDevice || !customerDevice.deviceToken || !customerDevice.ipAddress) {
            res.json({
                error: true,
                message: Resource.msg('error.payment.not.valid', 'checkout', null)
            });
            return next();
        }

        if (!payoneSecureInstallmentHelper.hasMatchingBillingAndShippingAddress(basket, customerOverride)) {
            res.json({
                error: true,
                message: Resource.msg('payone.error.secure_installment_address_mismatch', 'payoneError', null)
            });
            return next();
        }

        reservedOrderNo = payoneReservedOrderNoHelper.reserveFreshOrderNo();
        if (!reservedOrderNo) {
            LOGGER.error('PAYONE Secure Installment checkout creation aborted because an SFCC order number could not be reserved.');
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        if (!payoneMerchantReferenceHelper.validateOrderReferences(reservedOrderNo, true)) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        requestBody = payoneSecureInstallmentHelper.buildCreateRequestBodyFromBasket(
            basket,
            customerOverride,
            reservedOrderNo,
            customerDevice
        );
        createResult = commerceCaseService.create({
            body: requestBody
        });

        if (!createResult.ok || payoneCheckoutStateHelper.isRejected(payoneCheckoutStateHelper.getCheckout(createResult))) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: createResult.userMessage || Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        checkout = payoneCheckoutStateHelper.getCheckout(createResult);
        createCommerceCaseId = createResult && createResult.data ? createResult.data.commerceCaseId : null;
        createCheckoutId = checkout && checkout.checkoutId ? checkout.checkoutId : null;
        installmentOptions = payoneSecureInstallmentHelper.getInstallmentOptions(createResult);

        if (!installmentOptions.length) {
            LOGGER.warn(
                'PAYONE secured installment create succeeded but returned no installmentOptions; cancelling temporary checkout. Basket UUID: {0}, reservedOrderNo: {1}, commerceCaseId: {2}, checkoutId: {3}.',
                basket && basket.UUID ? basket.UUID : 'unknown',
                reservedOrderNo || 'unknown',
                createCommerceCaseId || 'unknown',
                createCheckoutId || 'unknown'
            );

            if (createCommerceCaseId && createCheckoutId) {
                cancelResult = orderManagementCheckoutActionsService.cancel({
                    commerceCaseId: createCommerceCaseId,
                    checkoutId: createCheckoutId,
                    body: new CancelCheckoutRequest({
                        cancelType: 'FULL',
                        cancellationReason: 'UNDELIVERABLE'
                    }).toRequest()
                });
                logCheckoutCancelFailure(
                    cancelResult,
                    'secure installment no-options cleanup',
                    createCommerceCaseId,
                    createCheckoutId
                );
            }

            res.json({
                error: true,
                message: Resource.msg('payone.error.secure_installment_no_options', 'payoneError', null)
            });
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            return next();
        }

        context = payoneSecureInstallmentHelper.storeCreateContext(
            req,
            basket,
            createResult,
            reservedOrderNo,
            customerOverride
        );

        if (!context) {
            payoneReservedOrderNoHelper.clearReservedOrderNo();
            res.json({
                error: true,
                message: Resource.msg('error.technical', 'checkout', null)
            });
            return next();
        }

        if (previousContext && previousContext.commerceCaseId && previousContext.checkoutId) {
            previousCheckoutState = payoneSecureInstallmentHelper.getCheckoutState(
                previousContext.commerceCaseId,
                previousContext.checkoutId
            );
            previousCheckout = previousCheckoutState && previousCheckoutState.checkout;

            if (previousCheckoutState
                && previousCheckoutState.getResult
                && previousCheckoutState.getResult.ok
                && payoneCheckoutStateHelper.canCancelCheckout(previousCheckout)
            ) {
                cancelResult = orderManagementCheckoutActionsService.cancel({
                    commerceCaseId: previousContext.commerceCaseId,
                    checkoutId: previousContext.checkoutId,
                    body: new CancelCheckoutRequest({
                        cancelType: 'FULL',
                        cancellationReason: 'CONSUMER_REQUEST'
                    }).toRequest()
                });
                logCheckoutCancelFailure(
                    cancelResult,
                    'secure installment context replacement',
                    previousContext.commerceCaseId,
                    previousContext.checkoutId
                );
            } else if (previousCheckoutState && previousCheckoutState.getResult && previousCheckoutState.getResult.ok) {
                LOGGER.info(
                    'Skipping PAYONE Secure Installment context replacement cancel because checkout status {0} is not cancellable. commerceCaseId: {1}, checkoutId: {2}.',
                    previousCheckout && previousCheckout.checkoutStatus ? previousCheckout.checkoutStatus : 'unknown',
                    previousContext.commerceCaseId,
                    previousContext.checkoutId
                );
            } else {
                LOGGER.warn(
                    'Unable to load latest PAYONE Secure Installment checkout state before context replacement cancel. commerceCaseId: {0}, checkoutId: {1}, userMessage: {2}.',
                    previousContext.commerceCaseId,
                    previousContext.checkoutId,
                    previousCheckoutState && previousCheckoutState.getResult && previousCheckoutState.getResult.userMessage
                        ? previousCheckoutState.getResult.userMessage
                        : 'unknown'
                );
            }
        }

        if (previousContextKey && previousContextKey !== context.contextKey) {
            payoneSecureInstallmentHelper.clearContext(req, previousContextKey);
        }

        res.json({
            error: false,
            contextKey: context.contextKey,
            installmentOptions: context.installmentOptions
        });
        return next();
    });

server.post(
    'SecureInstallmentCancel',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var contextKey = req.form.contextKey;
        var context = payoneSecureInstallmentHelper.getContext(req, contextKey);
        var checkoutState;
        var checkout;
        var cancelResult;

        if (context && context.commerceCaseId && context.checkoutId) {
            checkoutState = payoneSecureInstallmentHelper.getCheckoutState(
                context.commerceCaseId,
                context.checkoutId
            );
            checkout = checkoutState && checkoutState.checkout;

            if (checkoutState && checkoutState.getResult && checkoutState.getResult.ok && payoneCheckoutStateHelper.canCancelCheckout(checkout)) {
                cancelResult = orderManagementCheckoutActionsService.cancel({
                    commerceCaseId: context.commerceCaseId,
                    checkoutId: context.checkoutId,
                    body: new CancelCheckoutRequest({
                        cancelType: 'FULL',
                        cancellationReason: 'CONSUMER_REQUEST'
                    }).toRequest()
                });
                logCheckoutCancelFailure(
                    cancelResult,
                    'secure installment explicit cancel',
                    context.commerceCaseId,
                    context.checkoutId
                );
            } else if (checkoutState && checkoutState.getResult && checkoutState.getResult.ok) {
                LOGGER.info(
                    'Skipping PAYONE Secure Installment cancel because checkout status {0} is not cancellable. commerceCaseId: {1}, checkoutId: {2}.',
                    checkout && checkout.checkoutStatus ? checkout.checkoutStatus : 'unknown',
                    context.commerceCaseId,
                    context.checkoutId
                );
            } else {
                LOGGER.warn(
                    'Unable to load latest PAYONE Secure Installment checkout state before cancel. commerceCaseId: {0}, checkoutId: {1}, userMessage: {2}.',
                    context.commerceCaseId,
                    context.checkoutId,
                    checkoutState && checkoutState.getResult && checkoutState.getResult.userMessage
                        ? checkoutState.getResult.userMessage
                        : 'unknown'
                );
            }
        }

        if (contextKey) {
            payoneSecureInstallmentHelper.clearContext(req, contextKey);
        }
        payoneReservedOrderNoHelper.clearReservedOrderNo();

        res.json({});
        return next();
    });

server.get('PaypalReturn', server.middleware.https, function (req, res, next) {
    res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'payment').toString());
    return next();
});

server.get('Card3DSReturn', server.middleware.https, payonePostRedirectOrderHelper.handlePostRedirectOrderConfirmation);

server.get(
    'PostRedirectOrderConfirm',
    consentTracking.consent,
    server.middleware.https,
    csrfProtection.generateToken,
    payonePostRedirectOrderHelper.renderPostRedirectOrderConfirmation
);

server.post('OrderConfirm', server.middleware.https, payonePostRedirectOrderHelper.handlePostRedirectOrderConfirmation);

server.post('Webhook', server.middleware.https, function (req, res, next) {
    var WEBHOOK_LOGGER = Logger.getLogger('payone', 'webhook');

    var signatureHeader = request.httpHeaders['x-gcs-signature'];
    var keyIdHeader = request.httpHeaders['x-gcs-keyid'];
    var rawBody = request.httpParameterMap.requestBodyAsString;
    var verifyResult;
    var webhookEvent;
    var queueResult;

    if (!rawBody) {
        response.setStatus(400);
        res.json({
            accepted: false,
            code: 'MISSING_BODY',
            message: 'Webhook request body is required.'
        });
        return next();
    }

    if (!signatureHeader) {
        response.setStatus(400);
        res.json({
            accepted: false,
            code: 'MISSING_SIGNATURE',
            message: 'Missing x-gcs-signature header.'
        });
        return next();
    }

    verifyResult = webhookUtils.verifySignature(rawBody, signatureHeader, keyIdHeader);
    if (!verifyResult.ok) {
        response.setStatus(401);
        WEBHOOK_LOGGER.warn(
            'PAYONE webhook rejected. Code={0}, KeyId={1}',
            verifyResult.code || 'UNKNOWN',
            keyIdHeader || ''
        );
        res.json({
            accepted: false,
            code: verifyResult.code || 'SIGNATURE_MISMATCH',
            message: verifyResult.message || 'Invalid webhook signature.'
        });
        return next();
    }

    try {
        webhookEvent = JSON.parse(rawBody);
    } catch (parseError) {
        response.setStatus(400);
        res.json({
            accepted: false,
            code: 'INVALID_JSON',
            message: 'Webhook body must be valid JSON.'
        });
        return next();
    }

    if (!webhookEvent || !webhookEvent.id || !webhookEvent.type) {
        response.setStatus(400);
        res.json({
            accepted: false,
            code: 'INVALID_EVENT',
            message: 'Webhook payload must include id and type.'
        });
        return next();
    }

    queueResult = webhookUtils.queueWebhookEvent(webhookEvent, rawBody);
    if (queueResult.error) {
        response.setStatus(500);
        WEBHOOK_LOGGER.error(
            'PAYONE webhook could not be queued. EventId={0}, Type={1}, Error={2}',
            webhookEvent.id + '',
            webhookEvent.type + '',
            queueResult.errorMessage
        );
        res.json({
            accepted: false,
            code: 'QUEUE_ERROR',
            message: 'Could not queue webhook event.'
        });
        return next();
    }

    if (!queueResult.queued && !queueResult.duplicate) {
        response.setStatus(500);
        WEBHOOK_LOGGER.error(
            'PAYONE webhook could not be queued. EventId={0}, Type={1}',
            webhookEvent.id + '',
            webhookEvent.type + ''
        );
        res.json({
            accepted: false,
            code: 'QUEUE_ERROR',
            message: 'Could not queue webhook event.'
        });
        return next();
    }

    WEBHOOK_LOGGER.info(
        'PAYONE webhook accepted. EventId={0}, Type={1}, Duplicate={2}',
        queueResult.eventId || (webhookEvent.id + ''),
        webhookEvent.type + '',
        queueResult.duplicate ? 'true' : 'false'
    );

    res.json({
        accepted: true,
        queued: !!queueResult.queued,
        duplicate: !!queueResult.duplicate,
        eventId: queueResult.eventId || (webhookEvent.id + '')
    });

    return next();
});

server.post('UpdateBillingData', server.middleware.https, csrfProtection.validateAjaxRequest, function (req, res, next) {
    var Transaction = require('dw/system/Transaction');
    var AccountModel = require('*/cartridge/models/account');

    var billingForm = server.forms.getForm('billing');
    var currentBasket = BasketMgr.getCurrentBasket();
    var fieldErrors = [];

    if (!billingForm || !billingForm.addressFields || !currentBasket) {
        res.json({
            error: true,
            fieldErrors: fieldErrors,
            message: Resource.msg('error.no.billing.address', 'checkout', null)
        })

        return next();
    }

    var billingFormErrors = COHelpers.validateBillingForm(billingForm.addressFields);
    if (Object.keys(billingFormErrors).length) {
        fieldErrors.push(billingFormErrors);
    }

    var contactInfoFormErrors = COHelpers.validateFields(billingForm.contactInfoFields);
    if (Object.keys(contactInfoFormErrors).length) {
        fieldErrors.push(contactInfoFormErrors);
    }

    if (fieldErrors.length) {
        res.json({
            fieldErrors: fieldErrors,
            error: true
        });

        return next();
    }
    var billingAddress = currentBasket.billingAddress;

    Transaction.wrap(function () {
        if (!billingAddress) {
            billingAddress = currentBasket.createBillingAddress();
        }

        billingAddress.setFirstName(billingForm.addressFields.firstName.value);
        billingAddress.setLastName(billingForm.addressFields.lastName.value);
        billingAddress.setAddress1(billingForm.addressFields.address1.value);
        billingAddress.setAddress2(billingForm.addressFields.address2.value);
        billingAddress.setCity(billingForm.addressFields.city.value);
        billingAddress.setPostalCode(billingForm.addressFields.postalCode.value);

        if (Object.prototype.hasOwnProperty.call(billingForm.addressFields, 'states')) {
            billingAddress.setStateCode(billingForm.addressFields.states.stateCode.value);
        }

        billingAddress.setCountryCode(billingForm.addressFields.country.value);
        billingAddress.setPhone(billingForm.contactInfoFields.phone.value);
    });

    var viewData = getPaymentOptionsViewData(currentBasket, req);

    res.json({
        error: false,
        order: viewData.order,
        fieldErrors: fieldErrors,
        customer: new AccountModel(req.currentCustomer)
    })

    return next();
});

module.exports = server.exports();
