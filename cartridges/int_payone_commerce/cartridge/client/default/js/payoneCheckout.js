import {PCPCreditCardTokenizer} from 'pcp-client-javascript-sdk';
import GooglePayButton from '@google-pay/button-element';
import {loadScript} from "@paypal/paypal-js";

var checkoutData = {};
var hostedCardValidationScrollTimeout = null;
var hostedCardValidationInProgress = false;
var HOSTED_CARD_SCROLL_DELAY_MS = 1000;

checkoutData = window.payoneCheckoutData || {};

/**
 * Returns a localized shopper-facing checkout message from backend-rendered data.
 *
 * @param {string} key - Message key in checkoutData.messages.
 * @returns {string} Localized message.
 */
function getCheckoutMessage(key) {
    var messages = checkoutData.messages || {};

    return messages[key] || '';
}

/**
 * Shows a checkout error message.
 *
 * @param {string} message - Checkout error message.
 * @returns {void}
 */
function showCheckoutError(message) {
    var checkoutMessage = message || getCheckoutMessage('genericCheckoutError');

    if (!checkoutMessage) {
        return;
    }

    $('.error-message').show();
    $('.error-message-text').text(checkoutMessage);
}

/**
 * Scrolls the viewport to a checkout element when it is visible.
 *
 * @param {jQuery} $element - Element to scroll to.
 * @returns {void}
 */
function scrollToCheckoutElement($element) {
    if ($element && $element.length) {
        $('html, body').animate({
            scrollTop: Math.max($element.offset().top - 20, 0)
        }, 500);
    }
}

/**
 * Shows a checkout error message when one was provided during the initial page render.
 *
 * @returns {void}
 */
function showInitialCheckoutError() {
    var message = window.payoneCheckoutErrorMessage;

    if (!message) {
        return;
    }

    showCheckoutError(message);
}

/**
 * Clears the visible checkout error message.
 *
 * @returns {void}
 */
function clearCheckoutError() {
    $('.error-message').hide();
    $('.error-message-text').text('');
}

/**
 * Clears the hidden hosted-card token fields before a new tokenization attempt.
 *
 * @returns {void}
 */
function clearHostedCardTokenFields() {
    $('#hostedCardForm').val('');
    $('#hostedCardType').val('');
}

/**
 * Clears the deferred hosted-card validation scroll fallback.
 *
 * @returns {void}
 */
function clearHostedCardValidationScrollTimeout() {
    if (hostedCardValidationScrollTimeout) {
        window.clearTimeout(hostedCardValidationScrollTimeout);
        hostedCardValidationScrollTimeout = null;
    }
}

/**
 * Resets the hosted-card submit fallback state.
 *
 * @returns {void}
 */
function resetHostedCardValidationState() {
    hostedCardValidationInProgress = false;
    clearHostedCardValidationScrollTimeout();
}

/**
 * Scrolls back to the hosted card iframe when tokenization neither succeeds nor
 * returns a failure callback. This covers iframe-side validation states such as
 * empty required fields.
 *
 * @returns {void}
 */
function scheduleHostedCardValidationScroll() {
    resetHostedCardValidationState();
    hostedCardValidationInProgress = true;

    hostedCardValidationScrollTimeout = window.setTimeout(function () {
        if (!hostedCardValidationInProgress) {
            return;
        }

        hostedCardValidationInProgress = false;
        hostedCardValidationScrollTimeout = null;

        if ($('.tab-pane.active').attr('id') !== 'PAYONE_COMMERCE_CARD') {
            return;
        }

        if ($('#hostedCardForm').val()) {
            return;
        }

        scrollToCheckoutElement($('.payment-option-card#PAYONE_COMMERCE_CARD'));
    }, HOSTED_CARD_SCROLL_DELAY_MS);
}

/**
 * Builds a unique Payla snippet token for the current BNPL request.
 *
 * @returns {string|null} Snippet token or null when configuration is missing.
 */
function buildPaylaSnippetToken() {
    var fingerprintConfig = checkoutData.paylaFingerprintConfig || {};
    var partnerId = fingerprintConfig.paylaPartnerId;
    var merchantId = fingerprintConfig.partnerMerchantId;
    var uniquePart;

    if (!partnerId || !merchantId) {
        return null;
    }

    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        uniquePart = window.crypto.randomUUID();
    } else {
        uniquePart = String(Date.now()) + String(Math.random()).replace('.', '');
    }

    return partnerId + '_' + merchantId + '_' + uniquePart;
}

/**
 * Refreshes the Payla fingerprint token so the next BNPL API call uses the same token as the snippet.
 *
 * @returns {string|null} Fresh snippet token or null when fingerprinting cannot be refreshed.
 */
function refreshPaylaFingerprint() {
    var fingerprintConfig = checkoutData.paylaFingerprintConfig || {};
    var snippetToken = buildPaylaSnippetToken();
    var cssUrl;

    if (!window.paylaDcs || typeof window.paylaDcs.init !== 'function') {
        return fingerprintConfig.snippetToken || null;
    }

    if (!snippetToken) {
        return fingerprintConfig.snippetToken || null;
    }

    window.paylaDcsT = window.paylaDcs.init(fingerprintConfig.environment, snippetToken);
    cssUrl = 'https://d.payla.io/dcs/dcs.css?st=' + encodeURIComponent(snippetToken)
        + '&pi=' + encodeURIComponent(fingerprintConfig.paylaPartnerId)
        + '&psi=' + encodeURIComponent(fingerprintConfig.partnerMerchantId)
        + '&e=' + encodeURIComponent(fingerprintConfig.environment);
    $('#paylaDcsCss').attr('href', cssUrl);
    checkoutData.paylaFingerprintConfig.snippetToken = snippetToken;

    return snippetToken;
}

/**
 * Clears previously rendered payment-form validation errors.
 *
 * @param {string} parentSelector - Payment form selector.
 * @returns {void}
 */
function clearPaymentFormErrors(parentSelector) {
    $(parentSelector).find('.form-control.is-invalid').removeClass('is-invalid');
    clearCheckoutError();
}

/**
 * Renders payment-form validation errors using the native SFRA markup pattern.
 *
 * @param {string} parentSelector - Payment form selector.
 * @param {Object} fieldErrors - Validation error map.
 * @returns {void}
 */
function loadPaymentFormErrors(parentSelector, fieldErrors) {
    $.each(fieldErrors, function (attr) {
        $('*[name=' + attr + ']', parentSelector)
            .addClass('is-invalid')
            .siblings('.invalid-feedback')
            .html(fieldErrors[attr]);
    });

    scrollToCheckoutElement($(parentSelector));
}

var isPayPalAutoCheckoutActive = false;

/**
 * Toggles the native checkout buttons during the PayPal auto-continue flow.
 *
 * @param {boolean} isHidden - Whether to hide the button container.
 * @returns {void}
 */
function toggleAutoCheckoutButtons(isHidden) {
    $('.next-step-button').toggleClass('d-none', isHidden);
}

/**
 * Clears the stored approved PayPal payload from the billing form.
 *
 * @returns {void}
 */
function clearStoredPayPalApprovalData() {
    $('#paypalForm').val('');
}

/**
 * Restores the default checkout UI after the PayPal auto-continue flow ends.
 *
 * @returns {void}
 */
function resetPayPalAutoCheckoutState() {
    isPayPalAutoCheckoutActive = false;
    toggleAutoCheckoutButtons(false);
}

/**
 * Returns the approved PayPal context key stored in the hidden billing field.
 *
 * @returns {string} Stored context key or empty string.
 */
function getStoredPayPalContextKey() {
    var fieldValue = $('#paypalForm').val();
    var parsedValue;

    if (!fieldValue) {
        return '';
    }

    try {
        parsedValue = JSON.parse(fieldValue);
    } catch (error) {
        return '';
    }

    return parsedValue && parsedValue.contextKey ? parsedValue.contextKey : '';
}

/**
 * Returns the current checkout CSRF token when the billing form is present.
 *
 * @returns {string} CSRF token or empty string.
 */
function getCheckoutCsrfToken() {
    return $('#dwfrm_billing input[name=csrf_token]').val() || '';
}

/**
 * Clears the stored Google Pay payment payload from the hidden billing field.
 *
 * @returns {void}
 */
function clearStoredGooglePayPaymentData() {
    $('#googlePayForm').val('');
}

/**
 * Attempts to cancel the current PAYONE PayPal payment execution.
 *
 * @returns {void}
 */
function cancelPayPalPaymentAttempt() {
    var contextKey = getStoredPayPalContextKey();
    var csrfToken = getCheckoutCsrfToken();

    if (!contextKey || !checkoutData.urls || !checkoutData.urls.paypalCancel || !csrfToken) {
        return;
    }

    $.post(checkoutData.urls.paypalCancel, {
        contextKey: contextKey,
        csrf_token: csrfToken
    });
}

/**
 * Returns the stored Secure Installment selection payload.
 *
 * @returns {Object} Stored Secure Installment payload.
 */
function getStoredSecureInstallmentData() {
    var fieldValue = $('#secureInstallmentForm').val();
    var parsedValue;

    if (!fieldValue) {
        return {};
    }

    try {
        parsedValue = JSON.parse(fieldValue);
    } catch (error) {
        return {};
    }

    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
}

/**
 * Saves the current Secure Installment payload in the hidden field.
 *
 * @param {Object} data - Secure Installment hidden payload.
 * @returns {void}
 */
function setStoredSecureInstallmentData(data) {
    $('#secureInstallmentForm').val(data ? JSON.stringify(data) : '');
}

/**
 * Returns the primary checkout submit button.
 *
 * @returns {jQuery} Checkout button element.
 */
function getPrimaryCheckoutButton() {
    return $('.next-step-button .submit-payment');
}

/**
 * Stores the current checkout button label as the default order CTA.
 *
 * @returns {string} Default checkout button label.
 */
function getDefaultCheckoutButtonLabel() {
    var $button = getPrimaryCheckoutButton();
    var defaultLabel = $button.data('payoneDefaultLabel');

    if (!defaultLabel) {
        defaultLabel = $.trim($button.text());
        $button.data('payoneDefaultLabel', defaultLabel);
    }

    return defaultLabel;
}

/**
 * Updates the checkout CTA text for the current Secure Installment step.
 *
 * @returns {void}
 */
function updateCheckoutButtonLabel() {
    var $button = getPrimaryCheckoutButton();
    var activeTabId = $('.tab-pane.active').attr('id');
    var storedData = getStoredSecureInstallmentData();
    var secureInstallmentUi = checkoutData.secureInstallmentUi || {};
    var nextLabel;

    if (!$button.length) {
        return;
    }

    nextLabel = getDefaultCheckoutButtonLabel();

    if (activeTabId === 'PAYONE_COMMERCE_SECURE_INSTALLMENT') {
        if (storedData.contextKey && storedData.installmentOptionId) {
            nextLabel = getDefaultCheckoutButtonLabel();
        } else if (storedData.contextKey) {
            nextLabel = secureInstallmentUi.selectOptionLabel || 'Select an installment option';
        } else {
            nextLabel = secureInstallmentUi.loadOptionsLabel || 'Check installment options';
        }
    }

    $button.text(nextLabel);
}

/**
 * Clears rendered Secure Installment options and resets the selected option.
 *
 * @param {boolean} keepContextKey - Whether to preserve the stored context key.
 * @returns {void}
 */
function clearSecureInstallmentOptions(keepContextKey) {
    var storedData = getStoredSecureInstallmentData();
    var nextData = keepContextKey && storedData.contextKey ? { contextKey: storedData.contextKey } : null;

    setStoredSecureInstallmentData(nextData);
    $('.secure-installment-options-wrapper').addClass('d-none');
    $('.secure-installment-options').empty();
    $('.secure-installment-options-error').text('').hide();
    updateCheckoutButtonLabel();
}

/**
 * Returns whether Secure Installment options are currently rendered.
 *
 * @returns {boolean} True when at least one option is visible in the DOM.
 */
function hasRenderedSecureInstallmentOptions() {
    return $('input[name="payoneSecureInstallmentOption"]').length > 0
        && !$('.secure-installment-options-wrapper').hasClass('d-none');
}

/**
 * Attempts to cancel the current PAYONE Secure Installment checkout.
 *
 * @returns {void}
 */
function cancelSecureInstallmentAttempt() {
    var storedData = getStoredSecureInstallmentData();
    var csrfToken = getCheckoutCsrfToken();

    if (!storedData.contextKey || !checkoutData.urls || !checkoutData.urls.secureInstallmentCancel || !csrfToken) {
        return;
    }

    $.post(checkoutData.urls.secureInstallmentCancel, {
        contextKey: storedData.contextKey,
        csrf_token: csrfToken
    });
}

/**
 * Renders available Secure Installment options returned by PAYONE.
 *
 * @param {Array} options - Installment options returned by PAYONE.
 * @param {string} contextKey - Stored server-side context key.
 * @returns {void}
 */
function renderSecureInstallmentOptions(options, contextKey) {
    var $optionsContainer = $('.secure-installment-options');
    var optionsLabel = (checkoutData.secureInstallmentUi || {}).optionsLabel || 'Installment Options';

    $optionsContainer.empty();

    options.forEach(function (option, index) {
        var optionId = option && option.installmentOptionId ? option.installmentOptionId : '';
        var optionLabel = option && option.displayLabel ? option.displayLabel : '';
        var inputId = 'payoneSecureInstallmentOption' + index;
        var $optionWrapper = $('<div>').addClass('custom-control custom-radio secure-installment-option');
        var $input = $('<input>')
            .addClass('custom-control-input')
            .attr({
                type: 'radio',
                name: 'payoneSecureInstallmentOption',
                id: inputId,
                'data-context-key': contextKey
            })
            .val(optionId);
        var $label = $('<label>')
            .addClass('custom-control-label')
            .attr('for', inputId)
            .text(optionLabel);

        $optionWrapper.append($input, $label);
        $optionsContainer.append($optionWrapper);
    });

    $('.secure-installment-options-label').text(optionsLabel);
    $('.secure-installment-options-wrapper').removeClass('d-none');
    $('.secure-installment-options-error').text('').hide();
    setStoredSecureInstallmentData({
        contextKey: contextKey
    });
    updateCheckoutButtonLabel();
}

/**
 * Serializes one billing form section using the same SFRA checkout event hook.
 *
 * @param {string} selector - Section selector.
 * @returns {string} Serialized form payload.
 */
function serializeBillingSection(selector) {
    var $section = $(selector);
    var serializedFormData = $section.find(':input').serialize();

    $('body').trigger('checkout:serializeBilling', {
        form: $section,
        data: serializedFormData,
        callback: function (data) {
            if (data) {
                serializedFormData = data;
            }
        }
    });

    return serializedFormData;
}

/**
 * Builds the native SFRA SubmitPayment payload for the current billing form.
 *
 * @returns {string} Serialized SubmitPayment body.
 */
function buildSubmitPaymentPayload() {
    var billingAddressFormData = serializeBillingSection('#dwfrm_billing .billing-address-block');
    var contactInfoFormData = serializeBillingSection('#dwfrm_billing .contact-info-block');
    var activeTabId = $('.tab-pane.active').attr('id');
    var paymentInfoSelector = '#dwfrm_billing .' + activeTabId + ' .payment-form-fields';
    var paymentInfoFormData = serializeBillingSection(paymentInfoSelector);

    return billingAddressFormData + '&' + contactInfoFormData + '&' + paymentInfoFormData;
}

/**
 * Loads Secure Installment options from PAYONE using the current checkout form state.
 *
 * @returns {void}
 */
function loadSecureInstallmentOptions() {
    var storedData = getStoredSecureInstallmentData();
    var requestData = buildSubmitPaymentPayload();
    var paylaDeviceToken = refreshPaylaFingerprint();
    var csrfToken = getCheckoutCsrfToken();
    var secureInstallmentUi = checkoutData.secureInstallmentUi || {};

    if (!checkoutData.urls || !checkoutData.urls.secureInstallmentOptions) {
        showCheckoutError(secureInstallmentUi.unavailableMessage);
        scrollToCheckoutElement($('.error-message'));
        return;
    }

    if (!csrfToken) {
        showCheckoutError(secureInstallmentUi.loadOptionsErrorMessage);
        scrollToCheckoutElement($('.error-message'));
        return;
    }

    clearPaymentFormErrors('.payment-form');
    requestData += '&csrf_token=' + encodeURIComponent(csrfToken);

    if (paylaDeviceToken) {
        requestData += '&paylaDeviceToken=' + encodeURIComponent(paylaDeviceToken);
    }

    if (storedData.contextKey) {
        requestData += '&contextKey=' + encodeURIComponent(storedData.contextKey);
    }

    $('body').trigger('checkout:disableButton', '.next-step-button button');

    $.ajax({
        url: checkoutData.urls.secureInstallmentOptions,
        method: 'POST',
        data: requestData
    })
        .done(function (data) {
            $('body').trigger('checkout:enableButton', '.next-step-button button');

            if (data.fieldErrors && Object.keys(data.fieldErrors).length) {
                loadPaymentFormErrors('#PAYONE_COMMERCE_SECURE_INSTALLMENT .payment-form-fields', data.fieldErrors);

                if (data.message) {
                    showCheckoutError(data.message);
                }

                return;
            }

            if (data.error || !data.contextKey || !data.installmentOptions || !data.installmentOptions.length) {
                clearSecureInstallmentOptions(false);
                showCheckoutError((data && data.message) || secureInstallmentUi.loadOptionsErrorMessage);
                scrollToCheckoutElement($('.error-message'));
                return;
            }

            renderSecureInstallmentOptions(data.installmentOptions, data.contextKey);
            scrollToCheckoutElement($('.secure-installment-options-wrapper'));
        })
        .fail(function (jqXHR) {
            var responseJson = jqXHR && jqXHR.responseJSON;
            var responseText = jqXHR && jqXHR.responseText;
            var responseMessage = responseJson && responseJson.message;

            if (!responseMessage && responseText) {
                try {
                    responseMessage = JSON.parse(responseText).message;
                } catch (error) {
                    responseMessage = null;
                }
            }

            $('body').trigger('checkout:enableButton', '.next-step-button button');
            clearSecureInstallmentOptions(false);
            showCheckoutError(responseMessage || secureInstallmentUi.loadOptionsErrorMessage);
            scrollToCheckoutElement($('.error-message'));
        });
}

/**
 * Indicates whether the current Secure Installment selection is complete.
 *
 * @returns {boolean} True when a context key and installment option are stored.
 */
function hasSelectedSecureInstallmentOption() {
    var storedData = getStoredSecureInstallmentData();

    return !!(storedData.contextKey && storedData.installmentOptionId);
}

/**
 * Redirects to the SFRA order-confirmation continuation URL after PlaceOrder succeeds.
 *
 * @param {Object} data - PlaceOrder response payload.
 * @param {string} fallbackMessage - Message shown when the response is incomplete.
 * @returns {boolean} True when a redirect was started successfully.
 */
function submitPlaceOrderRedirect(data, fallbackMessage) {
    var errorMessage = fallbackMessage || getCheckoutMessage('genericCheckoutError');

    if (!data || typeof data !== 'object') {
        showCheckoutError(errorMessage);
        scrollToCheckoutElement($('.error-message'));
        return false;
    }

    if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return true;
    }

    if (!data.continueUrl || !data.orderID || !data.orderToken) {
        showCheckoutError(errorMessage);
        scrollToCheckoutElement($('.error-message'));
        return false;
    }

    var redirect = $('<form>')
        .appendTo(document.body)
        .attr({
            method: 'POST',
            action: data.continueUrl
        });

    $('<input>')
        .appendTo(redirect)
        .attr({
            type: 'hidden',
            name: 'orderID',
            value: data.orderID
        });

    $('<input>')
        .appendTo(redirect)
        .attr({
            type: 'hidden',
            name: 'orderToken',
            value: data.orderToken
        });

    redirect.submit();
    return true;
}

/**
 * Returns the selected billing payment method.
 *
 * @returns {string} Selected payment method id or empty string.
 */
function getSelectedPaymentMethodId() {
    return $('.payment-option-choice:checked').val() || '';
}

/**
 * Returns whether the currently selected payment method belongs to the PAYONE cartridge.
 *
 * @returns {boolean} True when a PAYONE method is selected.
 */
function isPayonePaymentMethodSelected() {
    return getSelectedPaymentMethodId().indexOf('PAYONE_COMMERCE_') === 0;
}

/**
 * Moves the checkout UI back to the server-provided error stage when possible.
 *
 * @param {Object} errorStage - SFRA errorStage payload.
 * @returns {void}
 */
function applyCheckoutErrorStage(errorStage) {
    if (!errorStage || !errorStage.stage) {
        return;
    }

    if (errorStage.stage === 'payment') {
        $('.payment-summary .edit-button').first().trigger('click');
        return;
    }

    if (errorStage.stage === 'shipping') {
        $('.shipping-summary .edit-button').first().trigger('click');
        return;
    }

    if (errorStage.stage === 'customer') {
        $('.customer-summary .edit-button').first().trigger('click');
    }
}

/**
 * Executes the PAYONE place-order request and handles redirect-style responses safely.
 *
 * @param {string} placeOrderUrl - CheckoutServices-PlaceOrder endpoint.
 * @param {string} genericErrorMessage - Fallback user-facing error.
 * @returns {void}
 */
function placePayoneOrder(placeOrderUrl, genericErrorMessage) {
    if (!placeOrderUrl) {
        showCheckoutError(genericErrorMessage);
        scrollToCheckoutElement($('.error-message'));
        return;
    }

    $('body').trigger('checkout:disableButton', '.next-step-button button');

    $.ajax({
        url: placeOrderUrl,
        method: 'POST',
        dataType: 'json'
    })
        .done(function (placeOrderResult) {
            $('body').trigger('checkout:enableButton', '.next-step-button button');

            if (!placeOrderResult || typeof placeOrderResult !== 'object') {
                showCheckoutError(genericErrorMessage);
                scrollToCheckoutElement($('.error-message'));
                return;
            }

            if (placeOrderResult.error) {
                if (placeOrderResult.cartError && placeOrderResult.redirectUrl) {
                    window.location.href = placeOrderResult.redirectUrl;
                    return;
                }

                applyCheckoutErrorStage(placeOrderResult.errorStage);
                showCheckoutError(placeOrderResult.errorMessage || genericErrorMessage);
                scrollToCheckoutElement($('.error-message'));
                return;
            }

            submitPlaceOrderRedirect(placeOrderResult, genericErrorMessage);
        })
        .fail(function (jqXHR) {
            var responseJson = jqXHR && jqXHR.responseJSON;

            $('body').trigger('checkout:enableButton', '.next-step-button button');

            if (responseJson && responseJson.redirectUrl) {
                window.location.href = responseJson.redirectUrl;
                return;
            }

            if (responseJson && responseJson.errorStage) {
                applyCheckoutErrorStage(responseJson.errorStage);
            }

            showCheckoutError((responseJson && responseJson.errorMessage) || genericErrorMessage);
            scrollToCheckoutElement($('.error-message'));
        });
}

/**
 * Handles a failed PayPal auto-checkout step consistently.
 *
 * @param {string} message - User-facing error message.
 * @returns {void}
 */
function handlePayPalCheckoutFailure(message) {
    cancelPayPalPaymentAttempt();
    clearStoredPayPalApprovalData();
    resetPayPalAutoCheckoutState();

    if (message) {
        showCheckoutError(message);
        scrollToCheckoutElement($('.error-message'));
    }
}

/**
 * Applies native SFRA SubmitPayment error rendering for the PayPal auto-continue flow.
 *
 * @param {Object} data - SubmitPayment response payload.
 * @returns {void}
 */
function renderSubmitPaymentErrors(data) {
    if (data.fieldErrors && data.fieldErrors.length) {
        data.fieldErrors.forEach(function (error) {
            if (Object.keys(error).length) {
                loadPaymentFormErrors('.payment-form', error);
            }
        });
    }

    if (data.serverErrors && data.serverErrors.length) {
        data.serverErrors.forEach(function (error) {
            showCheckoutError(error);
        });
        scrollToCheckoutElement($('.error-message'));
        return;
    }

    if (data.errorMessage) {
        showCheckoutError(data.errorMessage);
        scrollToCheckoutElement($('.error-message'));
    }
}

/**
 * Applies native SFRA post-SubmitPayment success UI updates.
 *
 * @param {Object} data - SubmitPayment success payload.
 * @returns {void}
 */
function applySubmitPaymentSuccess(data) {
    $('body').trigger('checkout:updateCheckoutView', {
        order: data.order,
        customer: data.customer
    });

    if (data.renderedPaymentInstruments) {
        $('.stored-payments').empty().html(data.renderedPaymentInstruments);
    }

    if (data.customer && data.customer.registeredUser
        && data.customer.customerPaymentInstruments
        && data.customer.customerPaymentInstruments.length
    ) {
        $('.cancel-new-payment').removeClass('checkout-hidden');
    }
}

/**
 * Keeps payment-option active state in sync without rebinding handlers on rerender.
 *
 * @returns {void}
 */
function bindPaymentOptionChoiceHandler() {
    $(document)
        .off('change.payonePaymentChoice', '.payment-option-choice')
        .on('change.payonePaymentChoice', '.payment-option-choice', function (event) {
            if (!$(this).is(':checked')) {
                return;
            }

            if (event.target.value !== 'PAYONE_COMMERCE_GOOGLEPAY') {
                clearStoredGooglePayPaymentData();
            }

            if (event.target.value !== 'PAYONE_COMMERCE_SECURE_INSTALLMENT' && getStoredSecureInstallmentData().contextKey) {
                cancelSecureInstallmentAttempt();
                clearSecureInstallmentOptions(false);
            }

            $('.payment-option-wrapper .payment-option-choice').each(function () {
                if (this !== event.target) {
                    $(this)
                        .prop('checked', false)
                        .closest('.payment-option-card, .payment-option-wrapper')
                        .removeClass('active');
                } else {
                    $(this)
                        .closest('.payment-option-card, .payment-option-wrapper')
                        .addClass('active');
                }
            });

            updateCheckoutButtonLabel();
        });
}

/**
 * Keeps Secure Installment context and option selection in sync with the current checkout inputs.
 *
 * @returns {void}
 */
function bindSecureInstallmentHandlers() {
    $(document)
        .off('change.payoneSecureInstallmentOption', 'input[name="payoneSecureInstallmentOption"]')
        .on('change.payoneSecureInstallmentOption', 'input[name="payoneSecureInstallmentOption"]', function () {
            setStoredSecureInstallmentData({
                contextKey: $(this).data('context-key'),
                installmentOptionId: $(this).val()
            });
            $('.secure-installment-options-error').text('').hide();
            updateCheckoutButtonLabel();
        });

    $(document)
        .off('input.payoneSecureInstallment change.payoneSecureInstallment', '#PAYONE_COMMERCE_SECURE_INSTALLMENT :input, #dwfrm_billing .billing-address-block :input, #dwfrm_billing .contact-info-block :input')
        .on('input.payoneSecureInstallment change.payoneSecureInstallment', '#PAYONE_COMMERCE_SECURE_INSTALLMENT :input, #dwfrm_billing .billing-address-block :input, #dwfrm_billing .contact-info-block :input', function () {
            if ($('.tab-pane.active').attr('id') !== 'PAYONE_COMMERCE_SECURE_INSTALLMENT') {
                return;
            }

            if (this.id === 'secureInstallmentForm' || this.name === 'payoneSecureInstallmentOption') {
                return;
            }

            if (getStoredSecureInstallmentData().contextKey) {
                cancelSecureInstallmentAttempt();
            }

            clearSecureInstallmentOptions(false);
        });
}

/**
 * Clears stored Google Pay data when checkout inputs change after wallet approval.
 *
 * @returns {void}
 */
function bindGooglePayHandlers() {
    $(document)
        .off('input.payoneGooglePay change.payoneGooglePay', '#dwfrm_billing .billing-address-block :input, #dwfrm_billing .contact-info-block :input')
        .on('input.payoneGooglePay change.payoneGooglePay', '#dwfrm_billing .billing-address-block :input, #dwfrm_billing .contact-info-block :input', function () {
            if ($('.tab-pane.active').attr('id') !== 'PAYONE_COMMERCE_GOOGLEPAY') {
                return;
            }

            clearStoredGooglePayPaymentData();
        });
}

/**
 * Continues from PayPal approval into native SFRA SubmitPayment and PlaceOrder AJAX calls.
 *
 * @returns {void}
 */
function continuePayPalCheckout() {
    var submitPaymentUrl;
    var placeOrderUrl;
    var paymentFormData;
    var genericErrorMessage = getCheckoutMessage('genericCheckoutError');

    if (isPayPalAutoCheckoutActive) {
        return;
    }

    submitPaymentUrl = $('#dwfrm_billing').attr('action');
    placeOrderUrl = $('.next-step-button .place-order').data('action');

    if (!submitPaymentUrl || !placeOrderUrl) {
        handlePayPalCheckoutFailure(genericErrorMessage);
        return;
    }

    isPayPalAutoCheckoutActive = true;
    clearPaymentFormErrors('.payment-form');
    toggleAutoCheckoutButtons(true);
    $('body').trigger('checkout:disableButton', '.next-step-button button');
    paymentFormData = buildSubmitPaymentPayload();

    $.ajax({
        url: submitPaymentUrl,
        method: 'POST',
        data: paymentFormData
    })
        .done(function (data) {
            $('body').trigger('checkout:enableButton', '.next-step-button button');

            if (data.error) {
                if (data.cartError && data.redirectUrl) {
                    handlePayPalCheckoutFailure(data.errorMessage || genericErrorMessage);
                    window.location.href = data.redirectUrl;
                    return;
                }

                renderSubmitPaymentErrors(data);
                handlePayPalCheckoutFailure();
                return;
            }

            applySubmitPaymentSuccess(data);

            $('body').trigger('checkout:disableButton', '.next-step-button button');

            $.ajax({
                url: placeOrderUrl,
                method: 'POST',
                dataType: 'json'
            })
                .done(function (placeOrderResult) {
                    $('body').trigger('checkout:enableButton', '.next-step-button button');

                    if (placeOrderResult.error) {
                        if (placeOrderResult.cartError && placeOrderResult.redirectUrl) {
                            handlePayPalCheckoutFailure(placeOrderResult.errorMessage || genericErrorMessage);
                            window.location.href = placeOrderResult.redirectUrl;
                            return;
                        }

                        handlePayPalCheckoutFailure(
                            placeOrderResult.errorMessage || genericErrorMessage
                        );
                        return;
                    }

                    if (!submitPlaceOrderRedirect(placeOrderResult, genericErrorMessage)) {
                        handlePayPalCheckoutFailure(genericErrorMessage);
                    }
                })
                .fail(function (jqXHR) {
                    $('body').trigger('checkout:enableButton', '.next-step-button button');

                    if (jqXHR.responseJSON && jqXHR.responseJSON.redirectUrl) {
                        handlePayPalCheckoutFailure(genericErrorMessage);
                        window.location.href = jqXHR.responseJSON.redirectUrl;
                        return;
                    }

                    handlePayPalCheckoutFailure(genericErrorMessage);
                });
        })
        .fail(function (err) {
            $('body').trigger('checkout:enableButton', '.next-step-button button');

            if (err.responseJSON && err.responseJSON.redirectUrl) {
                handlePayPalCheckoutFailure(genericErrorMessage);
                window.location.href = err.responseJSON.redirectUrl;
                return;
            }

            handlePayPalCheckoutFailure(genericErrorMessage);
        });
}

/**
* Retrieves and trims the value of a specified CSS custom property (CSS variable) from a given CSSStyleDeclaration object.
* @param {CSSStyleDeclaration} css - The CSSStyleDeclaration object to retrieve the variable from.
* @param {string} variableName - The name of the CSS variable (e.g., '--primary-color').
* @returns {string} The trimmed value of the specified CSS variable.
*/
function getCssVariableValue(css, variableName) {
    return css.getPropertyValue(variableName).trim();
}

/**
* Loads Payone UI configuration values from CSS custom properties applied to the payment IFrame element.
* Extracts various style-related CSS variables and organizes them into a configuration object for use in rendering the payment UI.
*
* @returns {Object} uiConfig - An object containing UI configuration values such as colors, font styles, margins, input and label styles, button styles, and separator styles.
*/
function loadUiConfigFromCssVars() {
    var el = document.getElementById('payment-IFrame');
    if (!el) return {};

    var css = getComputedStyle(el);
    var uiConfig = {};
    uiConfig.formBgColor = getCssVariableValue(css, '--payone-form-bg-color');
    uiConfig.formMarginLeft = getCssVariableValue(css, '--payone-form-margin-left');
    uiConfig.formMarginRight = getCssVariableValue(css, '--payone-form-margin-right');
    uiConfig.fieldBgColor = getCssVariableValue(css, '--payone-field-bg-color');

    uiConfig.fieldBorder = getCssVariableValue(css, '--payone-field-border');
    uiConfig.fieldOutline = getCssVariableValue(css, '--payone-field-outline');

    uiConfig.fieldLabelColor = getCssVariableValue(css, '--payone-field-label-color');
    uiConfig.fieldPlaceholderColor = getCssVariableValue(css, '--payone-field-placeholder-color');
    uiConfig.fieldTextColor = getCssVariableValue(css, '--payone-field-text-color');
    uiConfig.fieldErrorCodeColor = getCssVariableValue(css, '--payone-field-error-code-color');

    uiConfig.fontFamily = getCssVariableValue(css, '--payone-font-family');

    uiConfig.labelStyle = {};
    uiConfig.labelStyle.fontSize = getCssVariableValue(css, '--payone-label-font-size');
    uiConfig.labelStyle.fontWeight = getCssVariableValue(css, '--payone-label-font-weight');
    uiConfig.labelStyle.fontSizeMobile = getCssVariableValue(css, '--payone-label-font-size-mobile');

    uiConfig.inputStyle = {}
    uiConfig.inputStyle.fontSize = getCssVariableValue(css, '--payone-input-font-size');
    uiConfig.inputStyle.fontWeight = getCssVariableValue(css, '--payone-input-font-weight');
    uiConfig.inputStyle.fontSizeMobile = getCssVariableValue(css, '--payone-input-font-size-mobile');

    uiConfig.errorValidationStyle = {}
    uiConfig.errorValidationStyle.fontSize = getCssVariableValue(css, '--payone-error-font-size');
    uiConfig.errorValidationStyle.fontWeight = getCssVariableValue(css, '--payone-error-font-weight');
    uiConfig.errorValidationStyle.fontSizeMobile = getCssVariableValue(css, '--payone-error-font-size-mobile');

    uiConfig.btnBgColor = getCssVariableValue(css, '--payone-btn-bg-color');
    uiConfig.btnTextColor = getCssVariableValue(css, '--payone-btn-text-color');
    uiConfig.btnBorderColor = getCssVariableValue(css, '--payone-btn-border-color');

    uiConfig.separatorColor = getCssVariableValue(css, '--payone-separator-color');
    uiConfig.separatorTextColor = getCssVariableValue(css, '--payone-separator-text-color');

    uiConfig.inputBorderRadius = getCssVariableValue(css, '--payone-input-border-radius');
    uiConfig.inputBorderColorDefault = getCssVariableValue(css, '--payone-input-border-color-default');
    uiConfig.inputBorderColorSuccess = getCssVariableValue(css, '--payone-input-border-color-success');
    uiConfig.inputBorderColorError = getCssVariableValue(css, '--payone-input-border-color-error');
    uiConfig.inputFocusOutline = getCssVariableValue(css, '--payone-input-focus-outline');
    uiConfig.inputPadding = getCssVariableValue(css, '--payone-input-padding');
    uiConfig.fieldSpacingVertical = getCssVariableValue(css, '--payone-field-spacing-vertical');
    uiConfig.labelMarginBottom = getCssVariableValue(css, '--payone-label-margin-bottom');
    uiConfig.inputMarginBottom = getCssVariableValue(css, '--payone-input-margin-bottom');
    uiConfig.errorMarginBottom = getCssVariableValue(css, '--payone-error-margin-bottom');
    uiConfig.buttonMarginBottom = getCssVariableValue(css, '--payone-button-margin-bottom');
    return uiConfig;
}

var fetchJwt = async () => {
    try {
        var url = checkoutData?.urls?.cardToken;
        if (!url) {
            console.error('Missing checkoutData.urls.cardToken');
            return '';
        }

        var response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin'
        });

        if (!response.ok) {
            console.error('Request failed with status', response.status);
            return '';
        }

        var result = await response.json();

        var token =
            result?.getResult?.data?.token;

        if (!token) {
            console.error('JWT token not found in response', result);
            return '';
        }

        return token;
    } catch (e) {
        console.error('Error fetching JWT:', e);
        return '';
    }
};

var refreshCheckoutData = async () => {
    try {
        var url = checkoutData?.urls?.checkoutData;

        if (!url) {
            return checkoutData;
        }

        var response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin'
        });

        if (!response.ok) {
            console.error('Checkout data request failed with status', response.status);
            return checkoutData;
        }

        var result = await response.json();

        if (result && typeof result === 'object') {
            checkoutData = result;
        }
    } catch (error) {
        console.error('Error fetching checkout data:', error);
    }

    return checkoutData;
};

var initGooglePay = async () => {
    var $googlePayCard = $('.payment-option-card#PAYONE_COMMERCE_GOOGLEPAY');

    if ($googlePayCard.length > 0 && $googlePayCard.find('google-pay-button').length === 0) {
        var $container = $('#google-pay-container');
        var button = new GooglePayButton();

        button.environment = checkoutData.environment === 'production' ? 'PRODUCTION' : 'TEST';
        button.buttonLocale = checkoutData.googlePayButtonLocale || 'en';
        button.buttonType = 'pay';
        button.paymentRequest = checkoutData.googlePayConfig;

        $container.append(button);
        $(button).on('loadpaymentdata', function (event) {
            var $field = $('#googlePayForm');
            if ($field.length) {
                $field.val(JSON.stringify(event.originalEvent.detail));
            } else {
                console.warn('Input field with id "googlePayForm" not found.');
            }
        });
    }
};

var initCardForm = async () => {
    var $element = $('.payment-option-card#PAYONE_COMMERCE_CARD');
    if ($element.length > 0 && $element.find('iframe').length === 0) {
        var token = await fetchJwt();
        var uiConfig = loadUiConfigFromCssVars();
        var config = checkoutData.hostedFormConfig;

        config.uiConfig = uiConfig;
        config.token = token;
        config.locale = checkoutData.hostedTokenizerLocale || config.locale;

        config.tokenizationSuccessCallback = function (statusCode, tokenValue, cardDetails) {
            var $field = $('#hostedCardForm');
            var $cardTypeField = $('#hostedCardType');

            resetHostedCardValidationState();

            if ($field.length) {
                $field.val(tokenValue || '');
                $cardTypeField.val((cardDetails && cardDetails.cardType) || '');

                $('.next-step-button button').first().trigger('click');
            } else {
                console.warn('Input field with id "hostedCardForm" not found.');
            }
        };

        config.tokenizationFailureCallback = function (statusCode, errorResponse) {
            var $field = $('#hostedCardForm');
            var $cardTypeField = $('#hostedCardType');

            resetHostedCardValidationState();

            if ($field.length) {
                $field.val('');
                $cardTypeField.val('');
            } else {
                console.warn('Input field with id "hostedCardForm" not found.');
            }

            if (statusCode >= 400 && statusCode < 500) {
                scrollToCheckoutElement($('.payment-option-card#PAYONE_COMMERCE_CARD'));
                return;
            }

            if (errorResponse && errorResponse.error) {
                console.warn('PAYONE card tokenization failed:', errorResponse.error);
            }

            showCheckoutError(getCheckoutMessage('cardValidationError'));
            scrollToCheckoutElement($('.error-message'));
        };

        try {
            await PCPCreditCardTokenizer.create(config);
        } catch (error) {
            console.log(error);
        }
    }
};

var initPayPal = async () => {
    var $element = $('.payment-option-card#PAYONE_COMMERCE_PAYPAL');
    if ($element.length > 0 && $element.find('iframe').length === 0) {
        var paypalInstance = await loadScript(checkoutData.payPalConfig);
        var payPalContextKey = null;

        if (!checkoutData.payPalConfig['merchant-id']) {
            console.error('PayPal SDK merchant-id is not configured.');
            return;
        }

        if (!paypalInstance) {
            console.error("PayPal SDK failed to load");
            return;
        }

        paypalInstance.Buttons({

            style: {
                layout: "vertical",
                color: "gold",
                shape: "rect",
                label: "checkout",
                height: 40
            },

            createOrder: function () {
                var previousPayPalContextKey = payPalContextKey || getStoredPayPalContextKey();
                var csrfToken = getCheckoutCsrfToken();

                $('#paypalForm').val('');
                payPalContextKey = null;

                if (!csrfToken) {
                    return Promise.reject(new Error(getCheckoutMessage('paypalCreateError')));
                }

                return fetch(checkoutData.urls.paypalOrder, {
                    method: "POST",
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    },
                    body: new URLSearchParams({
                        previousContextKey: previousPayPalContextKey || '',
                        csrf_token: csrfToken
                    }).toString()
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.error || !data.payPalTransactionId || !data.contextKey) {
                            throw new Error((data && data.message) || getCheckoutMessage('paypalCreateError'));
                        }

                        payPalContextKey = data.contextKey;
                        return data.payPalTransactionId;
                    });

            },

            onApprove: function (data) {
                var $field = $('#paypalForm');
                var csrfToken = getCheckoutCsrfToken();

                if (!csrfToken) {
                    resetPayPalAutoCheckoutState();
                    return Promise.reject(new Error(getCheckoutMessage('paypalApproveError')));
                }

                return fetch(checkoutData.urls.paypalApprove, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    },
                    body: new URLSearchParams({
                        contextKey: payPalContextKey || '',
                        paypalData: JSON.stringify(data || {}),
                        csrf_token: csrfToken
                    }).toString()
                })
                    .then(function (res) {
                        return res.json();
                    })
                    .then(function (result) {
                        if (result.error || !result.approved || !result.contextKey) {
                            if (result.redirectUrl) {
                                window.location.href = result.redirectUrl;
                                return;
                            }

                            throw new Error((result && result.message) || getCheckoutMessage('paypalApproveError'));
                        }

                        $field.val(JSON.stringify({
                            approved: true,
                            contextKey: result.contextKey
                        }));

                        continuePayPalCheckout();
                    })
                    .catch(function (error) {
                        resetPayPalAutoCheckoutState();
                        showCheckoutError(error.message || getCheckoutMessage('paypalApproveError'));
                        scrollToCheckoutElement($('.error-message'));
                        throw error;
                    });
            },

            onCancel: function (data) {
                var csrfToken = getCheckoutCsrfToken();

                $('#paypalForm').val('');
                resetPayPalAutoCheckoutState();
                if (csrfToken) {
                    $.post(checkoutData.urls.paypalCancel, {
                        contextKey: payPalContextKey || '',
                        paypalData: JSON.stringify(data || {}),
                        csrf_token: csrfToken
                    });
                }
                payPalContextKey = null;
            },

            onError: function (err) {
                var csrfToken = getCheckoutCsrfToken();

                $('#paypalForm').val('');
                resetPayPalAutoCheckoutState();
                if (csrfToken) {
                    $.post(checkoutData.urls.paypalCancel, {
                        contextKey: payPalContextKey || '',
                        paypalData: JSON.stringify(err || {}),
                        csrf_token: csrfToken
                    });
                }
                payPalContextKey = null;
                showCheckoutError(getCheckoutMessage('paypalApproveError'));
                scrollToCheckoutElement($('.error-message'));
                console.error("PayPal SDK error:", err);
            }

        }).render("#paypal-button-container");
    }
}

/**
* Initializes the Apple Pay payment option behavior on the checkout page.
* Attaches an event listener to payment option choices and toggles the visibility
* of the "next step" button based on whether Apple Pay is selected.
* Hides the button when Apple Pay is chosen, otherwise shows it.
*
* @returns {void}
*/
function initApplePay() {
    if (window.location.hash === '#payment' && $('.payment-option-card.active').attr('id') !== 'DW_APPLE_PAY') {
        $('.next-step-button .submit-payment').show();
    }

    $('.payment-option-wrapper').on('change', '.payment-option-choice', function () {
        if ($(this).val() === 'DW_APPLE_PAY') {
            $('.next-step-button .submit-payment').hide();
        } else {
            $('.next-step-button .submit-payment').show();
        }
    });
}

/**
* Initializes all available payment options on the checkout page.
* Calls initialization functions for card form, Google Pay, and PayPal payment methods.
* @returns {void}
*/
async function initPaymentOptions() {
    $('.update-billing').addClass('d-none');
    await refreshCheckoutData();
    await initCardForm();
    await initGooglePay();
    await initPayPal();
    initApplePay();
}

/**
 * Updates the payment information in checkout, based on the supplied order model
 * @param {Object} order - checkout model to use as basis of new truth
 */
function updatePaymentInformation(order) {
    // update payment details
    var $paymentSummary = $('.payment-details');
    var htmlToAppend = '';

    if (order.billing.payment && order.billing.payment.selectedPaymentInstruments
        && order.billing.payment.selectedPaymentInstruments.length > 0) {
        var selectedPaymentMethodId = order.billing.payment.selectedPaymentInstruments[0].paymentMethod
        var paymentMethod = order.billing.payment.applicablePaymentMethods.find(function (method) {
            return method.ID === selectedPaymentMethodId;
        })
        htmlToAppend += '<span>' + paymentMethod.name || paymentMethod.ID + '</span>';
    }

    $paymentSummary.empty().append(htmlToAppend);
}

/**
* Updates the billing section UI by displaying the billing update element and hiding payment options and the submit payment button.
* This function manipulates DOM elements to reflect changes when billing data needs to be updated.
* No parameters or return value.
*/
function showUpdateBillingButton() {
    $('.update-billing').removeClass('d-none');
    $('.payment-option-wrapper').hide();
    $('.next-step-button .submit-payment').hide();
}

/**
* Updates the billing data on the server using the serialized billing address and contact information
* from the checkout form. Sends an AJAX POST request to update the billing data, handles errors by
* displaying an error message and scrolling to the error element, and triggers an event to update
* the checkout view with the latest order and customer data upon success.
*
* @returns {void}
*/
function updateBillingData() {
    var billingAddressFormData = serializeBillingSection('#dwfrm_billing .billing-address-block');
    var contactInfoFormData = serializeBillingSection('#dwfrm_billing .contact-info-block');
    var $paymentOptions = $('.payment-option-wrapper');

    var billingData = billingAddressFormData + '&' + contactInfoFormData;

    $paymentOptions.spinner().start();

    $.ajax({
        url: checkoutData.urls.updateBillingData,
        method: 'POST',
        data: billingData
    }).done(function (data) {
        if (data.fieldErrors && data.fieldErrors.length) {
            data.fieldErrors.forEach(function (error) {
                if (Object.keys(error).length) {
                    loadPaymentFormErrors('#dwfrm_billing', error);
                }
            });

            if (data.message) {
                showCheckoutError(data.message);
            }

            return;
        }

        if (data.error) {
            showCheckoutError((data && data.message) || getCheckoutMessage('billingUpdateError'));
            scrollToCheckoutElement($('.error-message'));
            return;
        }

        clearPaymentFormErrors('#dwfrm_billing');

        $('body').trigger('checkout:updateCheckoutView', {
            order: data.order,
            customer: data.customer
        });
    }).always(function () {
        $paymentOptions.spinner().stop();
    });
}

$(document).ready(function () {
    showInitialCheckoutError();

    if (document.querySelectorAll('[name="payoneCommerceCheckout"]').length > 0) {
        bindPaymentOptionChoiceHandler();
        bindSecureInstallmentHandlers();
        bindGooglePayHandlers();
        initPaymentOptions();
        updateCheckoutButtonLabel();

        $('.next-step-button .place-order').on('click', function (event) {
            var genericErrorMessage = getCheckoutMessage('genericCheckoutError');
            var placeOrderUrl;

            if (!isPayonePaymentMethodSelected()) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            placeOrderUrl = $(this).data('action');
            placePayoneOrder(placeOrderUrl, genericErrorMessage);
        });

        $('.next-step-button .submit-payment').on('click', function (event) {
            event.preventDefault();
            event.stopImmediatePropagation();

            if ($('.tab-pane.active').attr('id') === 'PAYONE_COMMERCE_CARD') {
                clearHostedCardTokenFields();
                scheduleHostedCardValidationScroll();
                $(checkoutData.hostedFormConfig.submitButton.selector).click();
            } else if ($('.tab-pane.active').attr('id') === 'PAYONE_COMMERCE_SECURE_INSTALLMENT') {
                if (hasSelectedSecureInstallmentOption()) {
                    $('.next-step-button button').first().click();
                    return;
                }

                if (getStoredSecureInstallmentData().contextKey) {
                    if (!hasRenderedSecureInstallmentOptions()) {
                        loadSecureInstallmentOptions();
                        return;
                    }

                    $('.secure-installment-options-error')
                        .text((checkoutData.secureInstallmentUi || {}).selectOptionErrorMessage)
                        .show();
                    scrollToCheckoutElement($('.secure-installment-options-wrapper'));
                    return;
                }

                loadSecureInstallmentOptions();
            } else {
                $('.next-step-button button').first().click();
            }
        });

        $('body').on('checkout:updateCheckoutView', function (e, responseData) {
            updatePaymentInformation(responseData.order);
            $.get(checkoutData.urls.paymentOptions, function (data) {
                $('.payment-option-wrapper').replaceWith(data);
                initPaymentOptions();
                updateCheckoutButtonLabel();
            });
        });

        $('#billingAddressSelector').on('change', function () {
            if ($(this).val() === 'new') {
                showUpdateBillingButton();
                return;
            }

            updateBillingData();
        })

        $('.update-billing').on('click', function () {
            updateBillingData();
        })

        $('.billing-address-block .btn-show-details, .billing-address-block .btn-add-new').on('click', function () {
            showUpdateBillingButton();
        })

        $('#dwfrm_billing .contact-info-block').on('change', function () {
            showUpdateBillingButton();
        })
    }
});
