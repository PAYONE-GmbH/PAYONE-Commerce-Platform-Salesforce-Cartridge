'use strict';

var OrderMgr = require('dw/order/OrderMgr');
var Logger = require('dw/system/Logger');

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var LOGGER = Logger.getLogger('payone', 'reservedOrderNo');
var PRIVACY_KEY = 'payoneReservedOrderNo';

/**
 * Normalizes an SFCC order number.
 *
 * @param {string|null} orderNo - Order number input.
 * @returns {string|null} Normalized order number.
 */
function normalizeOrderNo(orderNo) {
    return PayoneCommonUtils.trimString(orderNo, true) || null;
}

/**
 * Stores a reserved order number in session privacy for the SFRA createOrder step.
 *
 * @param {string|null} orderNo - Reserved order number.
 * @returns {string|null} Stored order number.
 */
function setReservedOrderNo(orderNo) {
    var normalizedOrderNo = normalizeOrderNo(orderNo);

    session.privacy[PRIVACY_KEY] = normalizedOrderNo;

    return normalizedOrderNo;
}

/**
 * Reads the reserved order number stored for the SFRA createOrder step.
 *
 * @returns {string|null} Reserved order number or null.
 */
function getReservedOrderNo() {
    return normalizeOrderNo(session.privacy[PRIVACY_KEY]);
}

/**
 * Clears the reserved order number stored for the SFRA createOrder step.
 *
 * @returns {void}
 */
function clearReservedOrderNo() {
    session.privacy[PRIVACY_KEY] = null;
}

/**
 * Reserves a fresh SFCC order number and stores it in session privacy.
 *
 * @returns {string|null} Reserved order number or null.
 */
function reserveFreshOrderNo() {
    var orderNo;

    try {
        orderNo = OrderMgr.createOrderNo();
    } catch (e) {
        LOGGER.error(
            'PAYONE reserved order number could not be created. Error: {0}. Stack: {1}',
            e.message,
            e.stack
        );
        return null;
    }

    return setReservedOrderNo(orderNo);
}

module.exports = {
    clearReservedOrderNo: clearReservedOrderNo,
    getReservedOrderNo: getReservedOrderNo,
    reserveFreshOrderNo: reserveFreshOrderNo
};
