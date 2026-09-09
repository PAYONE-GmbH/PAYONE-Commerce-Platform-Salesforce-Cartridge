var POLL_DELAYS = [500, 1000, 2000, 3000, 5000, 8000, 12000];

$(function () {
    var $root = $('.payone-post-redirect-processing');
    var $retryButton = $root.find('[data-action="retry"]');
    var $spinner = $root.find('.payone-processing-spinner');
    var attempt = 0;
    var automaticPolling = true;
    var inFlight = false;
    var timer = null;
    var checkStatus;

    if (!$root.length) {
        return;
    }

    /**
     * Shows one processing-state message.
     *
     * @param {string} messageName - Message state name.
     */
    function showMessage(messageName) {
        $root.find('[data-message]').addClass('d-none');
        $root.find('[data-message="' + messageName + '"]').removeClass('d-none');
    }

    /**
     * Stops automatic polling and exposes the manual retry action.
     *
     * @param {string} messageName - Message state name.
     */
    function showManualRetry(messageName) {
        automaticPolling = false;
        showMessage(messageName);
        $spinner.addClass('d-none');
        $retryButton.removeClass('d-none').prop('disabled', false);
    }

    /**
     * Schedules the next status request while the page is visible.
     *
     * @param {number} delay - Delay in milliseconds.
     */
    function scheduleNextCheck(delay) {
        if (document.hidden) {
            return;
        }

        timer = window.setTimeout(checkStatus, delay);
    }

    /**
     * Handles one status response from SFCC.
     *
     * @param {Object} result - Status response payload.
     */
    function handleResult(result) {
        if (result && result.redirectUrl) {
            window.location.assign(result.redirectUrl);
            return;
        }

        if (result && result.status === 'pending') {
            if (automaticPolling && attempt < POLL_DELAYS.length) {
                scheduleNextCheck(POLL_DELAYS[attempt]);
                attempt += 1;
                return;
            }

            showManualRetry('delayed');
            return;
        }

        showManualRetry('error');
    }

    /**
     * Requests the latest post-redirect payment status.
     */
    checkStatus = function () {
        var requestData = {
            nonce: $root.data('nonce'),
            orderNo: $root.data('order-no')
        };

        if (inFlight || document.hidden) {
            return;
        }

        requestData[$root.data('csrf-name')] = $root.data('csrf-token');
        inFlight = true;
        timer = null;

        $.ajax({
            data: requestData,
            method: 'POST',
            url: $root.data('status-url')
        }).done(handleResult).fail(function () {
            showManualRetry('error');
        }).always(function () {
            inFlight = false;
        });
    };

    $retryButton.on('click', function () {
        $retryButton.addClass('d-none').prop('disabled', true);
        $spinner.removeClass('d-none');
        showMessage('initial');
        checkStatus();
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (timer) {
                window.clearTimeout(timer);
                timer = null;
            }
            return;
        }

        if (automaticPolling && !inFlight && !timer) {
            checkStatus();
        }
    });

    scheduleNextCheck(POLL_DELAYS[attempt]);
    attempt += 1;
});
