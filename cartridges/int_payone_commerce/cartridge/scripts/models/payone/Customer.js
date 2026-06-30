'use strict';

var PayoneCommonUtils = require('*/cartridge/scripts/payone/PayoneCommonUtils');

var MAX_MERCHANT_CUSTOMER_ID_LENGTH = 20; // PAYONE Commerce API does not allow Customer.merchantCustomerId to exceed 20 characters.
var trimString = PayoneCommonUtils.trimString;
var clip = PayoneCommonUtils.clip;
var readField = PayoneCommonUtils.readField;

/**
 * Extracts the language portion from an SFCC locale string.
 *
 * @param {string} locale - Locale string such as `fr_FR`.
 * @returns {string|null} Lowercase language code.
 */
function toLocaleLanguage(locale) {
    var text = trimString(locale);
    return text ? text.split(/[_-]/)[0].toLowerCase() : null;
}

/**
 * Normalizes a country code to PAYONE format.
 *
 * @param {string} countryCode - Country code input.
 * @returns {string|null} Uppercase country code.
 */
function toCountryCode(countryCode) {
    var text = trimString(countryCode);
    return text ? text.toUpperCase() : null;
}

/**
 * Converts supported birth date inputs into PAYONE's `YYYYMMDD` format.
 *
 * @param {string|Date} value - Birth date input.
 * @returns {string|null} PAYONE-formatted birth date.
 */
function toPayoneBirthDateString(value) {
    var normalized;

    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        normalized = value.replace(/-/g, '');
        return /^\d{8}$/.test(normalized) ? normalized : null;
    }

    // eslint-disable-next-line no-restricted-globals
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
        return value.getFullYear()
            + ('0' + (value.getMonth() + 1)).slice(-2)
            + ('0' + value.getDate()).slice(-2);
    }

    return null;
}

/**
 * Converts a PAYONE `YYYYMMDD` birth date string into an SFCC-compatible Date.
 *
 * @param {string} value - PAYONE-formatted birth date.
 * @returns {Date|null} Parsed date object or null when invalid.
 */
function toSFCCBirthDate(value) {
    var normalized = trimString(value);
    var year;
    var month;
    var day;

    if (!normalized || !/^\d{8}$/.test(normalized)) {
        return null;
    }

    year = Number(normalized.substring(0, 4));
    month = Number(normalized.substring(4, 6));
    day = Number(normalized.substring(6, 8));

    return new Date(year, month - 1, day);
}

/**
 * Converts date-like input to a PAYONE ISO date-time string.
 *
 * @param {string|Date} value - Input date value.
 * @returns {string|null} ISO date-time string or trimmed text value.
 */
function toPayoneDateTime(value) {
    if (!value) {
        return null;
    }

    var text = trimString(value);

    // eslint-disable-next-line no-restricted-globals
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
        return value.toISOString();
    }

    return text || null;
}

/**
 * Maps an address-like object into the PAYONE customer billing address shape.
 *
 * @param {Object} source - Address-like input.
 * @returns {Object} Normalized billing address payload.
 */
function mapAddress(source) {
    var sourceCountryCode = readField(source, 'countryCode');
    var country = sourceCountryCode && sourceCountryCode.value
        ? sourceCountryCode.value
        : sourceCountryCode;

    return {
        street: trimString(readField(source, 'street') || readField(source, 'address1')),
        city: trimString(readField(source, 'city')),
        zip: trimString(readField(source, 'zip') || readField(source, 'postalCode')),
        countryCode: toCountryCode(country),
        additionalInfo: trimString(readField(source, 'additionalInfo') || readField(source, 'address2')),
        state: trimString(readField(source, 'state') || readField(source, 'stateCode'), true)
    };
}

/**
 * Resolves customer name fields from PAYONE, SFCC profile, and address sources.
 *
 * @param {Object} source - Root customer source object.
 * @param {Object} profile - SFCC customer profile.
 * @param {Object} billingAddress - Billing address object.
 * @returns {Object} Normalized name object.
 */
function mapName(source, profile, billingAddress) {
    var safeSource = source || {};
    var safeProfile = profile || {};
    var safeBilling = billingAddress || {};
    var personalName = (safeSource.personalInformation && safeSource.personalInformation.name) || {};

    return {
        firstName: trimString(personalName.firstName || safeProfile.firstName || safeBilling.firstName),
        surname: trimString(
            personalName.surname
            || safeProfile.lastName
            || safeBilling.lastName
        ),
        title: trimString(personalName.title || safeProfile.title)
    };
}

/**
 * Derives whether a customer should be treated as B2B or B2C.
 *
 * @param {Object} source - Root customer source object.
 * @param {Object} profile - SFCC customer profile.
 * @returns {string} PAYONE business relation value.
 */
function deriveBusinessRelation(source, profile) {
    var safeSource = source || {};
    var safeProfile = profile || {};
    var explicitRelation = trimString(safeSource.businessRelation);
    var companyName = trimString(
        (safeSource.companyInformation && safeSource.companyInformation.name)
        || safeProfile.companyName
    );
    var fiscalNumber = trimString(
        safeSource.fiscalNumber
        || safeProfile.taxID
        || safeProfile.taxIDMasked
    );

    if (explicitRelation === 'B2B' || explicitRelation === 'B2C') {
        return explicitRelation;
    }

    if (companyName && fiscalNumber) {
        return 'B2B';
    }

    return 'B2C';
}

/**
 * Resolves the fiscal number from the available customer sources.
 *
 * @param {Object} source - Root customer source object.
 * @param {Object} profile - SFCC customer profile.
 * @returns {string|null} Fiscal number when present.
 */
function resolveFiscalNumber(source, profile) {
    var safeSource = source || {};
    var safeProfile = profile || {};

    return trimString(
        safeSource.fiscalNumber
        || safeProfile.taxID
    );
}

/**
 * Resolves the account creation date from the available customer sources.
 *
 * @param {Object} source - Root customer source object.
 * @param {Object} profile - SFCC customer profile.
 * @returns {string|null} PAYONE-compatible account creation date.
 */
function resolveAccountCreateDate(source, profile) {
    var safeSource = source || {};
    var safeProfile = profile || {};
    var account = safeSource.account || {};
    var profileCreationDate = safeProfile.creationDate;

    if (!profileCreationDate && typeof safeProfile.getCreationDate === 'function') {
        try {
            profileCreationDate = safeProfile.getCreationDate();
        } catch (e) {
            profileCreationDate = null;
        }
    }

    return toPayoneDateTime(account.createDate || profileCreationDate);
}

/**
 * Indicates whether a value is a plain JavaScript object.
 *
 * @param {*} value - Value to inspect.
 * @returns {boolean} True when the value is a plain object.
 */
function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Clones a known address-like source into a plain JavaScript object.
 *
 * @param {Object} source - Address-like source object.
 * @returns {Object} Plain address object.
 */
function cloneAddressObject(source) {
    var cloned = {};
    var fields = [
        'street',
        'address1',
        'additionalInfo',
        'address2',
        'city',
        'zip',
        'postalCode',
        'countryCode',
        'state',
        'stateCode',
        'firstName',
        'lastName',
        'surname',
        'title',
        'phone'
    ];

    fields.forEach(function (field) {
        var value = readField(source, field);

        if (typeof value !== 'undefined' && value !== null) {
            cloned[field] = value;
        }
    });

    return cloned;
}

/**
 * Deep-merges a lightweight customer override into the base customer source.
 *
 * @param {Object} baseSource - Base customer source.
 * @param {Object} overrideSource - Checkout-specific override payload.
 * @returns {Object} Merged customer source.
 */
function mergeCustomerSource(baseSource, overrideSource) {
    var mergedSource = {};
    var safeBaseSource = baseSource || {};
    var safeOverrideSource = overrideSource || {};

    Object.keys(safeBaseSource).forEach(function (key) {
        mergedSource[key] = safeBaseSource[key];
    });

    Object.keys(safeOverrideSource).forEach(function (key) {
        var overrideValue = safeOverrideSource[key];
        var baseValue;
        var mergedNestedValue;

        if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
            baseValue = mergedSource[key];
            mergedNestedValue = {};

            if (isPlainObject(baseValue)) {
                Object.keys(baseValue).forEach(function (nestedKey) {
                    mergedNestedValue[nestedKey] = baseValue[nestedKey];
                });
            } else if (key === 'billingAddress') {
                mergedNestedValue = cloneAddressObject(baseValue);
            }

            Object.keys(overrideValue).forEach(function (nestedKey) {
                mergedNestedValue[nestedKey] = overrideValue[nestedKey];
            });

            mergedSource[key] = mergedNestedValue;
        } else {
            mergedSource[key] = overrideValue;
        }
    });

    return mergedSource;
}

/**
 * Deep-merges lightweight customer override payloads.
 *
 * @param {Object} baseOverride - Base override payload.
 * @param {Object} additionalOverride - Additional override payload.
 * @returns {Object|null} Merged override payload.
 */
function mergeOverrideData(baseOverride, additionalOverride) {
    var merged = {};

    /**
     * Merges one override source into the accumulated payload.
     *
     * @param {Object} source - Override source to merge.
     * @returns {void}
     */
    function assign(source) {
        Object.keys(source || {}).forEach(function (key) {
            var value = source[key];

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                merged[key] = merged[key] || {};
                Object.keys(value).forEach(function (nestedKey) {
                    var nestedValue = value[nestedKey];

                    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
                        merged[key][nestedKey] = merged[key][nestedKey] || {};
                        Object.keys(nestedValue).forEach(function (deepKey) {
                            merged[key][nestedKey][deepKey] = nestedValue[deepKey];
                        });
                    } else {
                        merged[key][nestedKey] = nestedValue;
                    }
                });
            } else {
                merged[key] = value;
            }
        });
    }

    assign(baseOverride || {});
    assign(additionalOverride || {});

    return Object.keys(merged).length ? merged : null;
}

/**
 * PAYONE customer model.
 *
 * @param {Object} source - PAYONE-like or SFCC-derived customer source object.
 * @constructor
 */
function Customer(source) {
    var safeSource = source || {};
    var profile = safeSource.profile || {};
    var billingAddress = safeSource.billingAddress || {};
    var personalInformation = safeSource.personalInformation || {};
    var contactDetails = safeSource.contactDetails || {};

    this.merchantCustomerId = clip(trimString(
        safeSource.merchantCustomerId || profile.customerNo
    ), MAX_MERCHANT_CUSTOMER_ID_LENGTH);
    this.locale = toLocaleLanguage(safeSource.locale);
    this.businessRelation = deriveBusinessRelation(safeSource, profile);
    this.fiscalNumber = resolveFiscalNumber(safeSource, profile);
    this.account = {
        createDate: resolveAccountCreateDate(safeSource, profile)
    };
    this.billingAddress = mapAddress(billingAddress);
    this.contactDetails = {
        emailAddress: trimString(
            contactDetails.emailAddress
            || safeSource.customerEmail
            || profile.email
        ),
        phoneNumber: trimString(
            contactDetails.phoneNumber
            || profile.phoneHome
            || billingAddress.phone
        )
    };
    this.personalInformation = {
        dateOfBirth: toPayoneBirthDateString(personalInformation.dateOfBirth || profile.birthday),
        name: mapName(safeSource, profile, billingAddress)
    };
    this.companyInformation = {
        name: trimString(
            (safeSource.companyInformation && safeSource.companyInformation.name)
            || profile.companyName
        )
    };
}

/**
 * Builds the PAYONE customer request payload.
 *
 * @returns {Object} PAYONE customer payload.
 */
Customer.prototype.toRequest = function () {
    var payload = {};
    var billingAddress = {};
    var contactDetails = {};
    var personalInformation = {};
    var name = {};
    var account = {};

    if (this.merchantCustomerId) {
        payload.merchantCustomerId = this.merchantCustomerId;
    }
    if (this.locale) {
        payload.locale = this.locale;
    }
    if (this.businessRelation) {
        payload.businessRelation = this.businessRelation;
    }
    if (this.fiscalNumber) {
        payload.fiscalNumber = this.fiscalNumber;
    }
    if (this.account.createDate) {
        account.createDate = this.account.createDate;
    }
    if (Object.keys(account).length) {
        payload.account = account;
    }

    if (this.billingAddress.street) {
        billingAddress.street = this.billingAddress.street;
    }
    if (this.billingAddress.city) {
        billingAddress.city = this.billingAddress.city;
    }
    if (this.billingAddress.zip) {
        billingAddress.zip = this.billingAddress.zip;
    }
    if (this.billingAddress.countryCode) {
        billingAddress.countryCode = this.billingAddress.countryCode;
    }
    if (this.billingAddress.additionalInfo) {
        billingAddress.additionalInfo = this.billingAddress.additionalInfo;
    }
    if (this.billingAddress.state) {
        billingAddress.state = this.billingAddress.state;
    }
    if (Object.keys(billingAddress).length) {
        payload.billingAddress = billingAddress;
    }

    if (this.contactDetails.emailAddress) {
        contactDetails.emailAddress = this.contactDetails.emailAddress;
    }
    if (this.contactDetails.phoneNumber) {
        contactDetails.phoneNumber = this.contactDetails.phoneNumber;
    }
    if (Object.keys(contactDetails).length) {
        payload.contactDetails = contactDetails;
    }

    if (this.personalInformation.name.firstName) {
        name.firstName = this.personalInformation.name.firstName;
    }
    if (this.personalInformation.name.surname) {
        name.surname = this.personalInformation.name.surname;
    }
    if (this.personalInformation.name.title) {
        name.title = this.personalInformation.name.title;
    }
    if (Object.keys(name).length) {
        personalInformation.name = name;
    }
    if (this.personalInformation.dateOfBirth) {
        personalInformation.dateOfBirth = this.personalInformation.dateOfBirth;
    }
    if (Object.keys(personalInformation).length) {
        payload.personalInformation = personalInformation;
    }

    if (this.companyInformation.name) {
        payload.companyInformation = this.companyInformation;
    }

    return payload;
};

/**
 * Creates a customer model from an SFCC order.
 *
 * @param {dw.order.Order|Object} order - SFCC order source.
 * @param {Object} [overrideData] - Optional checkout-specific customer override payload.
 * @returns {Customer} Customer model.
 */
Customer.fromOrder = function (order, overrideData) {
    var safeOrder = order || {};
    var orderCustomer = safeOrder.customer || {};
    var profile = orderCustomer.profile || {};
    var orderLocale = safeOrder.customerLocaleID;
    var baseSource = {
        merchantCustomerId: profile.customerNo || orderCustomer.ID,
        locale: orderLocale,
        customerEmail: safeOrder.customerEmail,
        billingAddress: safeOrder.billingAddress || {},
        profile: profile
    };

    return new Customer(mergeCustomerSource(baseSource, overrideData));
};

/**
 * Creates a customer model from an SFCC basket.
 *
 * @param {dw.order.Basket|Object} basket - SFCC basket source.
 * @param {Object} [overrideData] - Optional checkout-specific customer override payload.
 * @returns {Customer} Customer model.
 */
Customer.fromBasket = function (basket, overrideData) {
    var safeBasket = basket || {};
    var basketCustomer = safeBasket.customer || {};
    var profile = basketCustomer.profile || {};
    var locale = request.locale;
    var baseSource = {
        merchantCustomerId: profile.customerNo || basketCustomer.ID,
        locale: locale,
        customerEmail: safeBasket.customerEmail,
        billingAddress: safeBasket.billingAddress || {},
        profile: profile
    };

    return new Customer(mergeCustomerSource(baseSource, overrideData));
};

/**
 * Merges lightweight customer override payloads before they are applied to a basket or order customer model.
 *
 * @param {Object} baseOverride - Base override payload.
 * @param {Object} additionalOverride - Additional override payload.
 * @returns {Object|null} Merged override payload.
 */
Customer.mergeOverrideData = function (baseOverride, additionalOverride) {
    return mergeOverrideData(baseOverride, additionalOverride);
};

/**
 * Creates a customer model from a PAYONE response payload.
 *
 * @param {Object} payoneCustomer - PAYONE response object containing customer data.
 * @returns {Customer} Customer model.
 */
Customer.fromPayoneResponse = function (payoneCustomer) {
    var safeSource = payoneCustomer || {};
    return new Customer(safeSource.customer || safeSource);
};

/**
 * Converts the model into an SFCC-oriented order update payload.
 *
 * @returns {Object} Normalized customer update payload.
 */
Customer.prototype.toOrderUpdate = function () {
    var payload = {
        customerNo: this.merchantCustomerId || null,
        email: this.contactDetails.emailAddress || null,
        locale: this.locale || null,
        billingAddress: null,
        profile: null
    };

    if (this.billingAddress.street
        || this.billingAddress.city
        || this.billingAddress.zip
        || this.billingAddress.countryCode
        || this.billingAddress.state
        || this.billingAddress.additionalInfo) {
        payload.billingAddress = {
            address1: this.billingAddress.street || null,
            address2: this.billingAddress.additionalInfo || null,
            city: this.billingAddress.city || null,
            postalCode: this.billingAddress.zip || null,
            countryCode: this.billingAddress.countryCode || null,
            stateCode: this.billingAddress.state || null
        };
    }

    if (this.personalInformation.name.firstName
        || this.personalInformation.name.surname
        || this.personalInformation.name.title
        || this.personalInformation.dateOfBirth) {
        payload.profile = {
            firstName: this.personalInformation.name.firstName || null,
            lastName: this.personalInformation.name.surname || null,
            title: this.personalInformation.name.title || null,
            birthday: toSFCCBirthDate(this.personalInformation.dateOfBirth)
        };
    }

    return payload;
};

module.exports = Customer;
