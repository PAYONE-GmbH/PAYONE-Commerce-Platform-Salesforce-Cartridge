'use strict';

/**
 * Normalizes a value into a trimmed string.
 *
 * @param {*} value - Input value to normalize.
 * @param {boolean} [excludeStringFalsyValues] - When true, string placeholders such as "null" are treated as empty.
 * @returns {string|null} Trimmed string value or null when empty/invalid.
 */
function trimString(value, excludeStringFalsyValues) {
    if (value === null || typeof value === 'undefined') {
        return null;
    }

    var text = String(value).trim();

    if (!text) {
        return null;
    }

    if (excludeStringFalsyValues) {
        var normalized = text.toLowerCase();

        // Handle stringified falsy placeholders occasionally returned by SFCC/custom address flows.
        if (normalized === 'undefined' || normalized === 'null') {
            return null;
        }
    }

    return text;
}

/**
 * Truncates a string to the given maximum length.
 *
 * @param {string|null} text - String value to clip.
 * @param {number} maxLength - Maximum allowed string length.
 * @returns {string|null} Clipped string or null when input is empty.
 */
function clip(text, maxLength) {
    if (!text) {
        return null;
    }

    return text.length > maxLength ? text.substring(0, maxLength) : text;
}

/**
 * Normalizes optional list input into a native JavaScript array.
 *
 * @param {Array|dw.util.Collection|*} items - Array, scalar, or SFCC collection-like input.
 * @returns {Array} Native JavaScript array.
 */
function toArray(items) {
    // If the input is falsy, return an empty array.
    if (!items) {
        return [];
    }

    // If the input is a JavaScript array, return it as-is.
    if (Array.isArray(items)) {
        return items;
    }

    if (typeof items.toArray === 'function') {
        return items.toArray();
    }

    return [items];
}

/**
 * Safely reads a property from a potentially strict SFCC object.
 *
 * @param {Object} source - Source object.
 * @param {string} field - Field name to read.
 * @returns {*} Field value or null when unavailable.
 */
function readField(source, field) {
    try {
        return source ? source[field] : null;
    } catch (e) {
        return null;
    }
}

/**
 * Safely reads a custom attribute from an SFCC object that may not expose the field.
 *
 * @param {Object} source - SFCC object containing a `custom` map.
 * @param {string} key - Custom attribute name.
 * @returns {*} Attribute value or null when unavailable.
 */
function readCustomAttribute(source, key) {
    try {
        return source && source.custom ? source.custom[key] : null;
    } catch (e) {
        return null;
    }
}

/**
 * Checks whether a custom attribute is available on an SFCC object.
 *
 * @param {Object} source - SFCC object containing a `custom` map.
 * @param {string} key - Custom attribute name.
 * @returns {boolean} True when the attribute can be read.
 */
function hasCustomAttribute(source, key) {
    try {
        if (!source || !source.custom) {
            return false;
        }

        return typeof source.custom[key] !== 'undefined';
    } catch (e) {
        return false;
    }
}

/**
 * Parses a JSON string and suppresses malformed payload errors.
 *
 * @param {string} text - Serialized JSON string.
 * @returns {Object|Array|string|number|boolean|null} Parsed JSON value or null when invalid.
 */
function parseJson(text) {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

/**
 * Converts an SFCC money-like value to integer cents.
 *
 * @param {dw.value.Money|number|string|Object} value - Money-like input or object containing a `value` property.
 * @returns {number|null} Amount in cents or null when input cannot be parsed.
 */
function getMoneyInCents(value) {
    var number = value && typeof value === 'object' && typeof value.value !== 'undefined'
        ? Number(value.value)
        : Number(value);

    // eslint-disable-next-line no-restricted-globals
    return isNaN(number) ? null : Math.round(number * 100);
}

/**
 * Converts an integer-like value to an integer or null.
 *
 * @param {*} value - Input value to normalize.
 * @returns {number|null} Integer value or null when input is empty or not an integer.
 */
function toInt(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return null;
    }

    var number = Number(value);

    // eslint-disable-next-line no-restricted-globals
    return isNaN(number) || number % 1 !== 0 ? null : number;
}

/**
 * Copies a property from source to target when the value is present.
 *
 * @param {Object} target - Target object.
 * @param {Object} source - Source object.
 * @param {string} key - Property name to copy.
 * @returns {Object} Target object with the copied property when present.
 */
function copyIfPresent(target, source, key) {
    var updatedTarget = target;

    if (typeof source[key] !== 'undefined' && source[key] !== null) {
        updatedTarget[key] = source[key];
    }

    return updatedTarget;
}

module.exports = {
    trimString: trimString,
    clip: clip,
    getMoneyInCents: getMoneyInCents,
    toArray: toArray,
    toInt: toInt,
    copyIfPresent: copyIfPresent,
    readField: readField,
    readCustomAttribute: readCustomAttribute,
    hasCustomAttribute: hasCustomAttribute,
    parseJson: parseJson
};
