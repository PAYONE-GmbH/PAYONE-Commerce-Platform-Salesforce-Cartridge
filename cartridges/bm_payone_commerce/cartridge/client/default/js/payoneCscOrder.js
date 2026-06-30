'use strict';

(function () {
    /**
     * Re-triggers the invalid-input animation class on a field.
     *
     * @param {HTMLElement} field - CSC input field to highlight.
     */
    function triggerInvalidFieldAnimation(field) {
        field.classList.remove('invalid-input');
        field.getBoundingClientRect();
        field.classList.add('invalid-input');
    }

    /**
     * Returns the root CSC DOM element.
     *
     * @returns {Element|null} Root CSC element.
     */
    function getRootElement() {
        return document.querySelector('.payone-csc-order');
    }

    /**
     * Returns the BM sidebar element that wraps the CSC iframe.
     *
     * @returns {Element|null} Sidebar element when available.
     */
    function getSidebarElement() {
        var frameElement = window.frameElement;

        if (!frameElement) {
            return null;
        }

        return frameElement.closest('.dw-layout-sidebar');
    }

    /**
     * Returns the native BM close button for the sidebar that hosts the CSC iframe.
     *
     * @returns {HTMLElement|null} Close button when available.
     */
    function getSidebarCloseButton() {
        var sidebar = getSidebarElement();

        if (!sidebar) {
            return null;
        }

        return sidebar.querySelector('button[ng-click="dwCancel()"]');
    }

    /**
     * Removes the inline sidebar sizing added by CSC.
     */
    function restoreSidebarSize() {
        var sidebar = getSidebarElement();

        if (!sidebar) {
            return;
        }

        sidebar.style.removeProperty('width');
        sidebar.style.removeProperty('max-width');
    }

    /**
     * Expands the BM sidebar width for the CSC experience.
     */
    function widenSidebar() {
        var sidebar = getSidebarElement();

        if (!sidebar) {
            return;
        }

        sidebar.style.width = '86%';
        sidebar.style.maxWidth = '86%';
    }

    /**
     * Binds cleanup that restores sidebar sizing when CSC closes.
     *
     * The `pagehide` listener is a fallback for cases where the PAYONE CSC
     * extension is closed without using the native Close button, for example
     * when the BM sidebar is dismissed by another mechanism such as ESC.
     */
    function bindSidebarCleanup() {
        var closeButton = getSidebarCloseButton();

        if (closeButton) {
            closeButton.addEventListener('click', restoreSidebarSize);
        }

        window.removeEventListener('pagehide', restoreSidebarSize);
        window.addEventListener('pagehide', restoreSidebarSize);
    }

    /**
     * Returns the shared item-table inline error container.
     *
     * @returns {HTMLElement|null} Inline error element.
     */
    function getItemInlineErrorElement() {
        return document.getElementById('payone-csc-inline-error');
    }

    /**
     * Returns the order-level field error element for one form.
     *
     * @param {HTMLFormElement} form - Order-level action form.
     * @returns {HTMLElement|null} Order-level field error element.
     */
    function getOrderFieldErrorElement(form) {
        if (!form) {
            return null;
        }

        return form.querySelector('.payone-csc-order-field-error');
    }

    /**
     * Reads a message value from the root element data attributes.
     *
     * @param {string} attributeName - Root data attribute name.
     * @param {string} fallback - Fallback message.
     * @returns {string} Resolved message.
     */
    function getRootMessage(attributeName, fallback) {
        var root = getRootElement();

        if (!root) {
            return fallback;
        }

        return root.getAttribute(attributeName) || fallback;
    }

    /**
     * Toggles the CSC loading overlay and root loading state.
     *
     * @param {boolean} isLoading - Whether the CSC is processing an action.
     */
    function setCscLoadingState(isLoading) {
        var root = getRootElement();
        var loadingElement = document.getElementById('payone-csc-loading');

        if (!root || !loadingElement) {
            return;
        }

        root.classList.toggle('is-loading', isLoading);
        loadingElement.classList.toggle('is-hidden', !isLoading);
        loadingElement.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
    }

    /**
     * Clears all item-table row-level quantity validation errors.
     */
    function clearItemQuantityErrors() {
        Array.prototype.forEach.call(document.querySelectorAll('.payone-csc-item-quantity'), function (field) {
            field.classList.remove('invalid-input');
        });

        Array.prototype.forEach.call(document.querySelectorAll('.payone-csc-item-error'), function (fieldError) {
            fieldError.textContent = '';
            fieldError.classList.add('is-hidden');
        });
    }

    /**
     * Shows an exceeded-quantity validation error for one item-table row.
     *
     * @param {HTMLElement} quantityField - Quantity input field.
     * @param {string} actionType - `capture` or `refund`.
     * @param {number} availableQuantity - Maximum available quantity.
     */
    function showMaxQuantityError(quantityField, actionType, availableQuantity) {
        var itemId;
        var errorElement;
        var actionLabel = actionType === 'refund' ? 'refund' : 'capture';
        var messageTemplate = getRootMessage('data-quantity-exceeded-message', 'Maximum {0} quantity is {1} for this item.');

        if (!quantityField) {
            return;
        }

        itemId = quantityField.getAttribute('data-item-id');
        errorElement = itemId ? document.querySelector('.payone-csc-item-error[data-item-id="' + itemId + '"]') : null;

        triggerInvalidFieldAnimation(quantityField);

        if (errorElement) {
            errorElement.textContent = messageTemplate
                .replace('{0}', actionLabel)
                .replace('{1}', String(availableQuantity));
            errorElement.classList.remove('is-hidden');
        }
    }

    /**
     * Shows a below-minimum validation error for one item-table row.
     *
     * @param {HTMLElement} quantityField - Quantity input field.
     * @param {string} actionType - `capture` or `refund`.
     * @param {number} minimumQuantity - Minimum allowed quantity.
     */
    function showMinimumQuantityError(quantityField, actionType, minimumQuantity) {
        var itemId;
        var errorElement;
        var actionLabel = actionType === 'refund' ? 'refund' : 'capture';
        var messageTemplate = getRootMessage('data-quantity-below-minimum-message', 'Minimum {0} quantity is {1} for this item.');

        if (!quantityField) {
            return;
        }

        itemId = quantityField.getAttribute('data-item-id');
        errorElement = itemId ? document.querySelector('.payone-csc-item-error[data-item-id="' + itemId + '"]') : null;

        triggerInvalidFieldAnimation(quantityField);

        if (errorElement) {
            errorElement.textContent = messageTemplate
                .replace('{0}', actionLabel)
                .replace('{1}', String(minimumQuantity));
            errorElement.classList.remove('is-hidden');
        }
    }

    /**
     * Shows a whole-number validation error for one item-table row.
     *
     * @param {HTMLElement} quantityField - Quantity input field.
     */
    function showWholeNumberError(quantityField) {
        var itemId;
        var errorElement;
        var message = getRootMessage('data-whole-number-message', 'Enter a whole number for this item.');

        if (!quantityField) {
            return;
        }

        itemId = quantityField.getAttribute('data-item-id');
        errorElement = itemId ? document.querySelector('.payone-csc-item-error[data-item-id="' + itemId + '"]') : null;

        triggerInvalidFieldAnimation(quantityField);

        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.remove('is-hidden');
        }
    }

    /**
     * Clears the shared item-table inline error and all row-level quantity errors.
     */
    function clearItemInlineError() {
        var errorElement = getItemInlineErrorElement();

        if (!errorElement) {
            return;
        }

        errorElement.textContent = '';
        errorElement.classList.add('is-hidden');
        clearItemQuantityErrors();
    }

    /**
     * Shows the shared item-table inline error message.
     *
     * @param {string} message - Error message to render.
     */
    function showItemInlineError(message) {
        var errorElement = getItemInlineErrorElement();

        if (!errorElement) {
            return;
        }

        errorElement.textContent = message;
        errorElement.classList.remove('is-hidden');
    }

    /**
     * Clears the order-level field error message for one form.
     *
     * @param {HTMLFormElement} form - Order-level action form.
     */
    function clearOrderInlineError(form) {
        var errorElement = getOrderFieldErrorElement(form);
        var field = form ? form.querySelector('.payone-csc-order-amount-input, .payone-csc-order-select') : null;

        if (field) {
            field.classList.remove('invalid-input');
        }

        if (!errorElement) {
            return;
        }

        errorElement.textContent = '';
        errorElement.classList.add('is-hidden');
    }

    /**
     * Clears all order-level field error messages.
     */
    function clearAllOrderInlineErrors() {
        var root = getRootElement();

        if (!root) {
            return;
        }

        Array.prototype.forEach.call(root.querySelectorAll('.payone-csc-order-field-error'), function (errorElement) {
            errorElement.textContent = '';
            errorElement.classList.add('is-hidden');
        });

        Array.prototype.forEach.call(root.querySelectorAll('.payone-csc-order-amount-input'), function (field) {
            field.classList.remove('invalid-input');
        });

        Array.prototype.forEach.call(root.querySelectorAll('.payone-csc-order-select'), function (field) {
            field.classList.remove('invalid-input');
        });
    }

    /**
     * Shows the order-level field error message for one form.
     *
     * @param {HTMLFormElement} form - Order-level action form.
     * @param {string} message - Error message to render.
     */
    function showOrderInlineError(form, message) {
        var errorElement = getOrderFieldErrorElement(form);
        var field = form ? form.querySelector('.payone-csc-order-amount-input, .payone-csc-order-select') : null;

        if (field) {
            triggerInvalidFieldAnimation(field);
        }

        if (!errorElement) {
            return;
        }

        errorElement.textContent = message;
        errorElement.classList.remove('is-hidden');
    }

    /**
     * Applies placeholder styling to the cancel-reason select when no real value is selected.
     *
     * @param {HTMLSelectElement} select - Cancel-reason select field.
     */
    function syncCancelReasonPlaceholderState(select) {
        if (!select) {
            return;
        }

        select.classList.toggle('is-placeholder-selected', !select.value);
    }

    /**
     * Builds the selector for one item-table action checkbox.
     *
     * @param {string} actionType - `capture` or `refund`.
     * @param {string} itemId - CSC selection id.
     * @returns {string} Checkbox selector.
     */
    function getItemActionCheckboxSelector(actionType, itemId) {
        return '.payone-csc-item-checkbox[data-action="' + actionType + '"][data-item-id="' + itemId + '"]';
    }

    /**
     * Returns the item-table quantity field for one CSC selection id.
     *
     * @param {string} itemId - CSC selection id.
     * @returns {HTMLElement|null} Quantity input field.
     */
    function getItemQuantityField(itemId) {
        return document.querySelector('.payone-csc-item-quantity[data-item-id="' + itemId + '"]');
    }

    /**
     * Synchronizes one item-table row's quantity field with the currently selected action.
     *
     * @param {string} itemId - CSC selection id.
     */
    function syncItemQuantityField(itemId) {
        var quantityField = getItemQuantityField(itemId);
        var captureCheckbox;
        var refundCheckbox;
        var actionsUnavailable;
        var captureQty;
        var refundQty;
        var defaultMax;
        var selectedMax;
        var currentValue;

        if (!quantityField) {
            return;
        }

        captureCheckbox = document.querySelector(getItemActionCheckboxSelector('capture', itemId));
        refundCheckbox = document.querySelector(getItemActionCheckboxSelector('refund', itemId));
        actionsUnavailable = (!captureCheckbox || captureCheckbox.disabled) &&
            (!refundCheckbox || refundCheckbox.disabled);
        captureQty = parseInt(quantityField.getAttribute('data-capture-qty'), 10) || 0;
        refundQty = parseInt(quantityField.getAttribute('data-refund-qty'), 10) || 0;
        defaultMax = parseInt(quantityField.getAttribute('data-default-process-qty'), 10) || 0;
        selectedMax = defaultMax;

        if (actionsUnavailable) {
            quantityField.disabled = true;
            quantityField.removeAttribute('max');
            quantityField.value = '0';
            return;
        }

        if (captureCheckbox && captureCheckbox.checked) {
            selectedMax = captureQty;
        } else if (refundCheckbox && refundCheckbox.checked) {
            selectedMax = refundQty;
        }
        currentValue = Number(quantityField.value) || 0;

        if (selectedMax > 0) {
            quantityField.disabled = false;
            quantityField.setAttribute('max', String(selectedMax));

            if (currentValue < 1 || currentValue > selectedMax) {
                quantityField.value = '1';
            }

            return;
        }

        quantityField.disabled = true;
        quantityField.removeAttribute('max');
        quantityField.value = '0';
    }

    /**
     * Enforces mutual exclusivity between capture and refund for one item-table row.
     *
     * @param {HTMLInputElement} checkbox - Toggled action checkbox.
     */
    function handleItemActionToggle(checkbox) {
        var itemId;
        var siblingAction;
        var siblingCheckbox;

        if (!checkbox) {
            return;
        }

        itemId = checkbox.getAttribute('data-item-id');
        siblingAction = checkbox.getAttribute('data-action') === 'capture' ? 'refund' : 'capture';
        siblingCheckbox = itemId ? document.querySelector(getItemActionCheckboxSelector(siblingAction, itemId)) : null;

        if (checkbox.checked && siblingCheckbox) {
            siblingCheckbox.checked = false;
        }

        syncItemQuantityField(itemId);
    }

    /**
     * Makes item-table capture/refund cells clickable by forwarding to the checkbox.
     */
    function bindItemActionCellClicks() {
        var table = document.querySelector('.payone-csc-table');

        if (!table) {
            return;
        }

        table.addEventListener('click', function (event) {
            var cell = event.target ? event.target.closest('.payone-csc-action-cell') : null;
            var checkbox;

            if (!cell || !table.contains(cell)) {
                return;
            }

            if (event.target && event.target.closest('input')) {
                return;
            }

            checkbox = cell.querySelector('.payone-csc-item-checkbox');

            if (!checkbox || checkbox.disabled) {
                return;
            }

            checkbox.click();
        });
    }

    /**
     * Binds delegated change/input/keydown handling for CSC table fields.
     */
    function bindItemTableFieldEvents() {
        var table = document.querySelector('.payone-csc-table');

        if (!table) {
            return;
        }

        table.addEventListener('change', function (event) {
            var target = event.target;

            if (!target) {
                return;
            }

            if (target.matches('.payone-csc-item-checkbox')) {
                clearItemInlineError();
                handleItemActionToggle(target);
                return;
            }

            if (target.matches('.payone-csc-item-quantity')) {
                clearItemInlineError();
            }
        });

        table.addEventListener('input', function (event) {
            var target = event.target;

            if (!target) {
                return;
            }

            if (target.matches('.payone-csc-item-quantity')) {
                clearItemInlineError();
            }
        });

        table.addEventListener('keydown', function (event) {
            var target = event.target;
            var blockedKeys = ['e', 'E', '+', '-', '.', ','];

            if (!target || !target.matches('.payone-csc-item-quantity')) {
                return;
            }

            if (blockedKeys.indexOf(event.key) !== -1) {
                event.preventDefault();
            }
        });
    }

    /**
     * Collects and validates the selected rows from the item-level operations table.
     *
     * @param {string} actionType - `capture` or `refund`.
     * @returns {Object} Selection state, validated items, and first invalid field.
     */
    function getSelectedItemTableSelections(actionType) {
        var selectedItems = [];
        var hasInvalidQuantity = false;
        var hasCheckedItems = false;
        var firstInvalidField = null;
        var minimumQuantity = 1;

        Array.prototype.forEach.call(document.querySelectorAll('.payone-csc-item-checkbox[data-action="' + actionType + '"]'), function (checkbox) {
            var itemId;
            var quantityField;
            var quantity;
            var availableQuantity;
            var rawValue;
            var hasBadInput;

            if (!checkbox.checked) {
                return;
            }

            hasCheckedItems = true;
            itemId = checkbox.getAttribute('data-item-id');
            quantityField = getItemQuantityField(itemId);
            rawValue = quantityField ? quantityField.value : '';
            hasBadInput = quantityField && quantityField.validity ? quantityField.validity.badInput : false;
            quantity = quantityField ? Number(rawValue) : 0;
            availableQuantity = quantityField ? parseInt(quantityField.getAttribute('data-' + actionType + '-qty'), 10) : 0;

            if (!itemId || !quantityField) {
                return;
            }

            // eslint-disable-next-line no-restricted-globals
            if (hasBadInput || rawValue === '' || !isFinite(quantity) || quantity % 1 !== 0) {
                hasInvalidQuantity = true;
                if (!firstInvalidField) {
                    firstInvalidField = quantityField;
                }
                showWholeNumberError(quantityField);
                return;
            }

            if (quantity < minimumQuantity) {
                hasInvalidQuantity = true;
                if (!firstInvalidField) {
                    firstInvalidField = quantityField;
                }
                showMinimumQuantityError(quantityField, actionType, minimumQuantity);
                return;
            }

            if (!availableQuantity || quantity > availableQuantity) {
                hasInvalidQuantity = true;
                if (!firstInvalidField) {
                    firstInvalidField = quantityField;
                }
                showMaxQuantityError(quantityField, actionType, availableQuantity || 0);
                return;
            }

            selectedItems.push({
                id: itemId,
                quantity: quantity
            });
        });

        return {
            items: selectedItems,
            hasInvalidQuantity: hasInvalidQuantity,
            hasCheckedItems: hasCheckedItems,
            firstInvalidField: firstInvalidField
        };
    }

    /**
     * Normalizes the free-form amount text used by order-level operations.
     *
     * @param {string} text - Raw amount text.
     * @returns {string} Normalized decimal string.
     */
    function normalizeAmountText(text) {
        var normalized = String(text || '').trim().replace(/\s+/g, '');
        var lastCommaIndex;
        var lastDotIndex;
        var digitsAfterSeparator;
        var firstSeparatorIndex;

        if (!normalized) {
            return '';
        }

        lastCommaIndex = normalized.lastIndexOf(',');
        lastDotIndex = normalized.lastIndexOf('.');

        if (lastCommaIndex !== -1 && lastDotIndex !== -1) {
            if (lastCommaIndex > lastDotIndex) {
                return normalized.replace(/\./g, '').replace(',', '.');
            }

            return normalized.replace(/,/g, '');
        }

        if (lastCommaIndex !== -1) {
            digitsAfterSeparator = normalized.length - lastCommaIndex - 1;
            firstSeparatorIndex = normalized.indexOf(',');

            if (firstSeparatorIndex !== lastCommaIndex) {
                if (digitsAfterSeparator >= 1 && digitsAfterSeparator <= 2) {
                    return normalized.slice(0, lastCommaIndex).replace(/,/g, '') + '.'
                        + normalized.slice(lastCommaIndex + 1);
                }

                return normalized.replace(/,/g, '');
            }

            if (digitsAfterSeparator >= 1 && digitsAfterSeparator <= 2) {
                return normalized.replace(',', '.');
            }

            if (digitsAfterSeparator === 3) {
                return normalized.replace(/,/g, '');
            }
        }

        if (lastDotIndex !== -1) {
            digitsAfterSeparator = normalized.length - lastDotIndex - 1;
            firstSeparatorIndex = normalized.indexOf('.');

            if (firstSeparatorIndex !== lastDotIndex) {
                if (digitsAfterSeparator >= 1 && digitsAfterSeparator <= 2) {
                    return normalized.slice(0, lastDotIndex).replace(/\./g, '') + '.'
                        + normalized.slice(lastDotIndex + 1);
                }

                return normalized.replace(/\./g, '');
            }

            if (digitsAfterSeparator === 3) {
                return normalized.replace(/\./g, '');
            }
        }

        return normalized;
    }

    /**
     * Validates the overall money-input structure before normalization.
     *
     * Accepted forms:
     * - Plain integer: `1887`
     * - Plain decimal: `1887.00`, `1887,00`
     * - Comma-grouped with dot decimals: `1,887.00`, `1,887,431.00`
     * - Dot-grouped with comma decimals: `1.887,00`, `1.887.431,00`
     *
     * @param {string} text - Raw amount text.
     * @returns {boolean} True when the structure is valid.
     */
    function hasValidAmountStructure(text) {
        var normalized = String(text || '').trim().replace(/\s+/g, '');
        var commaCount = (normalized.match(/,/g) || []).length;
        var dotCount = (normalized.match(/\./g) || []).length;
        var separatorIndex;

        if (!normalized) {
            return false;
        }

        if (commaCount + dotCount === 1) {
            separatorIndex = Math.max(normalized.indexOf(','), normalized.indexOf('.'));

            if (normalized.length - separatorIndex - 1 === 3) {
                return false;
            }
        }

        return /^\d+$/.test(normalized)
            || /^\d+[.,]\d{1,2}$/.test(normalized)
            || /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(normalized)
            || /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized);
    }

    /**
     * Parses a decimal amount string into cents for CSC validation.
     *
     * @param {string} text - Raw amount text.
     * @returns {number|null} Amount in cents or null when invalid.
     */
    function parseAmountToCents(text) {
        var normalized = normalizeAmountText(text);

        if (!hasValidAmountStructure(text)) {
            return null;
        }

        if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
            return null;
        }

        return Math.round(Number(normalized) * 100);
    }

    /**
     * Sanitizes free-form amount text to digits and common decimal/group separators.
     *
     * @param {string} text - Raw amount text.
     * @returns {string} Sanitized amount text.
     */
    function sanitizeAmountText(text) {
        var rawText = String(text || '');
        var sanitized = '';
        var i;
        var character;
        var previousCharacter;

        for (i = 0; i < rawText.length; i += 1) {
            character = rawText.charAt(i);
            previousCharacter = sanitized.charAt(sanitized.length - 1);

            if (character >= '0' && character <= '9') {
                sanitized += character;
            } else if (character === '.' || character === ',') {
                if (previousCharacter !== '.' && previousCharacter !== ',') {
                    sanitized += character;
                }
            }
        }

        return sanitized;
    }

    /**
     * Binds one item-level capture/refund form to the selected item payload builder.
     *
     * @param {string} formId - Form element id.
     * @param {string} actionType - `capture` or `refund`.
     */
    function bindItemSelectionForm(formId, actionType) {
        var form = document.getElementById(formId);
        var root = getRootElement();
        var selectItemsMessage = root
            ? root.getAttribute(actionType === 'refund' ? 'data-select-items-refund-message' : 'data-select-items-capture-message')
            : null;
        var invalidQuantityMessage = root ? root.getAttribute('data-invalid-quantity-message') : 'Selected quantity is not available for this action.';

        if (!selectItemsMessage) {
            selectItemsMessage = root ? root.getAttribute('data-select-items-message') : 'Select at least one item first from the table.';
        }

        if (!form) {
            return;
        }

        form.addEventListener('submit', function (event) {
            clearItemInlineError();

            var selectionState = getSelectedItemTableSelections(actionType);
            var selectedItems = selectionState.items;
            var hiddenField = form.querySelector('input[name="selectedItems"]');

            if (!selectedItems.length) {
                if (selectionState.hasCheckedItems && selectionState.hasInvalidQuantity) {
                    event.preventDefault();
                    showItemInlineError(invalidQuantityMessage);
                    return;
                }

                event.preventDefault();
                showItemInlineError(selectItemsMessage);
                return;
            }

            if (selectionState.hasInvalidQuantity) {
                event.preventDefault();
                showItemInlineError(invalidQuantityMessage);
                return;
            }

            hiddenField.value = JSON.stringify(selectedItems);
            setCscLoadingState(true);
        });
    }

    /**
     * Binds input and submit validation handlers to the order-level amount forms.
     */
    function bindOrderAmountForms() {
        Array.prototype.forEach.call(document.querySelectorAll('.payone-csc-order-form'), function (form) {
            var input = form.querySelector('.payone-csc-order-amount-input');

            if (input) {
                input.addEventListener('keydown', function (event) {
                    var allowedControlKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
                    var isDigit = event.key >= '0' && event.key <= '9';
                    var isSeparator = event.key === '.' || event.key === ',';
                    var selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
                    var selectionEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
                    var characterBeforeSelection = input.value.charAt(Math.max(selectionStart - 1, 0));
                    var characterAfterSelection = input.value.charAt(selectionEnd);
                    var hasAdjacentSeparator = characterBeforeSelection === '.'
                        || characterBeforeSelection === ','
                        || characterAfterSelection === '.'
                        || characterAfterSelection === ',';

                    if (allowedControlKeys.indexOf(event.key) !== -1) {
                        return;
                    }

                    if (isDigit) {
                        return;
                    }

                    if (isSeparator) {
                        if (hasAdjacentSeparator) {
                            event.preventDefault();
                        }

                        return;
                    }

                    if (event.ctrlKey || event.metaKey) {
                        return;
                    }

                    if (['e', 'E', '+', '-'].indexOf(event.key) !== -1 || event.key.length === 1) {
                        event.preventDefault();
                    }
                });

                input.addEventListener('input', function () {
                    var sanitizedValue = sanitizeAmountText(input.value);

                    if (input.value !== sanitizedValue) {
                        input.value = sanitizedValue;
                    }

                    clearOrderInlineError(form);
                });
            }

            form.addEventListener('submit', function (event) {
                var amountInput = form.querySelector('.payone-csc-order-amount-input');
                var actionType;
                var amount;
                var maxAmount;
                var maxAmountDisplay;
                var invalidAmountMessage;
                var minimumAmountMessage;
                var exceededAmountMessage;

                clearItemInlineError();
                clearAllOrderInlineErrors();

                if (!amountInput) {
                    return;
                }

                actionType = amountInput.getAttribute('data-action') || 'capture';
                amount = parseAmountToCents(amountInput.value);
                maxAmount = parseInt(amountInput.getAttribute('data-max-amount'), 10) || 0;
                maxAmountDisplay = amountInput.getAttribute('data-max-amount-display') || String(maxAmount);
                invalidAmountMessage = getRootMessage('data-invalid-amount-message', 'Enter a valid amount with up to 2 decimals for this action.');
                minimumAmountMessage = getRootMessage('data-amount-below-minimum-message', 'Enter an amount greater than 0 for this action.');
                exceededAmountMessage = getRootMessage('data-amount-exceeded-message', 'Maximum {0} amount is {1} for this action.');

                if (amount === null) {
                    event.preventDefault();
                    showOrderInlineError(form, invalidAmountMessage);
                    return;
                }

                if (amount <= 0) {
                    event.preventDefault();
                    showOrderInlineError(form, minimumAmountMessage);
                    return;
                }

                if (!maxAmount || amount > maxAmount) {
                    event.preventDefault();
                    showOrderInlineError(form, exceededAmountMessage
                        .replace('{0}', actionType)
                        .replace('{1}', maxAmountDisplay));
                    return;
                }

                amountInput.value = normalizeAmountText(amountInput.value);
                setCscLoadingState(true);
            });
        });
    }

    /**
     * Binds change and submit validation handlers to the cancel-order form.
     */
    function bindCancelOrderForm() {
        var form = document.getElementById('payone-csc-cancel-order');
        var select;
        var invalidCancelReasonMessage;

        if (!form) {
            return;
        }

        select = form.querySelector('.payone-csc-order-select');
        invalidCancelReasonMessage = getRootMessage('data-invalid-cancel-reason-message', 'You must select a reason first.');

        if (select) {
            syncCancelReasonPlaceholderState(select);

            select.addEventListener('change', function () {
                syncCancelReasonPlaceholderState(select);
                clearOrderInlineError(form);
            });
        }

        form.addEventListener('submit', function (event) {
            clearItemInlineError();
            clearAllOrderInlineErrors();

            if (!select || select.value) {
                setCscLoadingState(true);
                return;
            }

            event.preventDefault();
            showOrderInlineError(form, invalidCancelReasonMessage);
        });
    }

    /**
     * Binds the CSC tab buttons that switch between item-level and order-level panels.
     */
    function bindTabs() {
        var root = getRootElement();

        if (!root) {
            return;
        }

        root.addEventListener('click', function (event) {
            var tab = event.target ? event.target.closest('.payone-csc-tab') : null;
            var targetName;

            if (!tab || !root.contains(tab)) {
                return;
            }

            targetName = tab.getAttribute('data-tab-target');

            Array.prototype.forEach.call(root.querySelectorAll('.payone-csc-tab'), function (tabButton) {
                var isActive = tabButton === tab;

                tabButton.classList.toggle('is-active', isActive);
                tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            Array.prototype.forEach.call(root.querySelectorAll('.payone-csc-tab-panel'), function (panel) {
                panel.classList.toggle('is-active', panel.getAttribute('data-tab-panel') === targetName);
            });
        });
    }

    /**
     * Initializes the CSC page behavior once the DOM is ready.
     */
    document.addEventListener('DOMContentLoaded', function () {
        widenSidebar();
        bindSidebarCleanup();

        bindTabs();
        bindItemActionCellClicks();
        bindItemTableFieldEvents();
        bindOrderAmountForms();

        Array.prototype.forEach.call(document.querySelectorAll('.payone-csc-item-quantity'), function (field) {
            syncItemQuantityField(field.getAttribute('data-item-id'));
        });

        bindItemSelectionForm('payone-csc-capture', 'capture');
        bindItemSelectionForm('payone-csc-refund', 'refund');
        bindCancelOrderForm();
    });
}());
