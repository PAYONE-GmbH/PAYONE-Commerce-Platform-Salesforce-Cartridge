'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var Customer = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/Customer', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils')
});

describe('Customer model', function () {
    afterEach(function () {
        delete global.request;
    });

    it('should map SFCC-style customer input into PAYONE request payload', function () {
        var creationDate = new Date('2024-01-02T03:04:05.000Z');
        var model = new Customer({
            profile: {
                customerNo: 'customer-12345678901234567890-extra',
                email: 'john@example.com',
                firstName: 'John',
                lastName: 'Doe',
                title: 'Mr',
                birthday: new Date(1990, 0, 1),
                companyName: 'Acme SAS',
                taxID: 'FR123456789',
                creationDate: creationDate
            },
            billingAddress: {
                address1: 'Test Street',
                address2: 'Happy Friday Center',
                city: 'Paris',
                postalCode: '75003',
                countryCode: {
                    value: 'fr'
                },
                stateCode: 'IDF',
                phone: '+335555555555'
            },
            locale: 'fr_FR'
        });

        var payload = model.toRequest();

        assert.equal(payload.merchantCustomerId, 'customer-12345678901');
        assert.equal(payload.locale, 'fr');
        assert.equal(payload.businessRelation, 'B2B');
        assert.equal(payload.fiscalNumber, 'FR123456789');
        assert.equal(payload.account.createDate, creationDate.toISOString());
        assert.equal(payload.billingAddress.countryCode, 'FR');
        assert.equal(payload.billingAddress.additionalInfo, 'Happy Friday Center');
        assert.equal(payload.contactDetails.emailAddress, 'john@example.com');
        assert.equal(payload.contactDetails.phoneNumber, '+335555555555');
        assert.equal(payload.personalInformation.dateOfBirth, '19900101');
        assert.equal(payload.personalInformation.name.firstName, 'John');
        assert.equal(payload.personalInformation.name.surname, 'Doe');
        assert.equal(payload.companyInformation.name, 'Acme SAS');
    });

    it('should default business relation to B2C without full business markers', function () {
        var model = new Customer({
            profile: {
                companyName: 'Acme SAS'
            }
        });

        assert.equal(model.toRequest().businessRelation, 'B2C');
    });

    it('should preserve explicit B2B business relation', function () {
        var model = new Customer({
            businessRelation: 'B2B'
        });

        assert.equal(model.toRequest().businessRelation, 'B2B');
    });

    it('should preserve legitimate surname values while filtering placeholder state values', function () {
        var model = new Customer({
            locale: 'en_US',
            billingAddress: {
                address1: 'Main Street 1',
                city: 'Berlin',
                postalCode: '10115',
                countryCode: {
                    value: 'DE'
                },
                stateCode: 'null',
                firstName: 'Jason',
                lastName: 'Null'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.billingAddress.state, undefined);
        assert.equal(payload.personalInformation.name.firstName, 'Jason');
        assert.equal(payload.personalInformation.name.surname, 'Null');
    });

    it('should build from basket using request locale and billing phone fallback', function () {
        global.request = {
            locale: 'tr_TR'
        };

        var model = Customer.fromBasket({
            customerEmail: 'basket@example.com',
            billingAddress: {
                address1: 'Street',
                city: 'Berlin',
                postalCode: '10115',
                countryCode: {
                    value: 'DE'
                },
                phone: '+49123456789',
                firstName: 'John',
                lastName: 'Doe'
            },
            customer: {
                profile: {
                    customerNo: '20001'
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.locale, 'tr');
        assert.equal(payload.merchantCustomerId, '20001');
        assert.equal(payload.contactDetails.emailAddress, 'basket@example.com');
        assert.equal(payload.contactDetails.phoneNumber, '+49123456789');
        assert.equal(payload.personalInformation.name.firstName, 'John');
    });

    it('should map PAYONE response back to SFCC-shaped order update payload', function () {
        var model = Customer.fromPayoneResponse({
            customer: {
                merchantCustomerId: 'cust-20001',
                locale: 'en',
                contactDetails: {
                    emailAddress: 'wrapped@example.com'
                },
                personalInformation: {
                    dateOfBirth: '20020707',
                    name: {
                        firstName: 'Jane',
                        surname: 'Doe',
                        title: 'Mrs'
                    }
                },
                billingAddress: {
                    street: 'Main Street 1',
                    city: 'Berlin',
                    zip: '10115',
                    countryCode: 'DE',
                    state: 'BE'
                }
            }
        });

        var updatePayload = model.toOrderUpdate();

        assert.equal(updatePayload.customerNo, 'cust-20001');
        assert.equal(updatePayload.email, 'wrapped@example.com');
        assert.equal(updatePayload.locale, 'en');
        assert.equal(updatePayload.billingAddress.address1, 'Main Street 1');
        assert.equal(updatePayload.billingAddress.postalCode, '10115');
        assert.equal(updatePayload.profile.firstName, 'Jane');
        assert.equal(updatePayload.profile.lastName, 'Doe');
        assert.equal(updatePayload.profile.title, 'Mrs');
        assert.equal(Object.prototype.toString.call(updatePayload.profile.birthday), '[object Date]');
    });

    it('should omit invalid birthday values from request payload', function () {
        var model = new Customer({
            personalInformation: {
                dateOfBirth: 'not-a-date',
                name: {
                    firstName: 'John',
                    surname: 'Doe'
                }
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.personalInformation.dateOfBirth, undefined);
    });

    it('should not mutate strict SFCC address objects when applying checkout overrides', function () {
        global.request = {
            locale: 'de_DE'
        };

        var strictBillingAddress = new Proxy({
            address1: 'Bernburger',
            city: 'Berlin',
            postalCode: '12689',
            countryCode: {
                value: 'DE'
            },
            phone: '+49123456789',
            firstName: 'John',
            lastName: 'Doe'
        }, {
            set: function () {
                throw new Error('strict object mutated');
            }
        });

        var model = Customer.fromBasket({
            customerEmail: 'basket@example.com',
            billingAddress: strictBillingAddress,
            customer: {
                profile: {
                    customerNo: '20001'
                }
            }
        }, {
            billingAddress: {
                street: 'Bernburger',
                city: 'Berlin',
                zip: '12689',
                countryCode: 'DE'
            },
            personalInformation: {
                dateOfBirth: '19970314',
                name: {
                    firstName: 'John',
                    surname: 'Doe'
                }
            },
            contactDetails: {
                phoneNumber: '+49111111111'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.billingAddress.street, 'Bernburger');
        assert.equal(payload.contactDetails.phoneNumber, '+49111111111');
        assert.equal(payload.personalInformation.dateOfBirth, '19970314');
    });

    it('should merge lightweight customer override payloads without using payment-method helpers', function () {
        var mergedOverride = Customer.mergeOverrideData({
            billingAddress: {
                street: 'Main Street 1'
            },
            contactDetails: {
                emailAddress: 'basket@example.com'
            },
            personalInformation: {
                name: {
                    firstName: 'Jason',
                    surname: 'Null'
                }
            }
        }, {
            contactDetails: {
                phoneNumber: '+49111111111'
            },
            personalInformation: {
                dateOfBirth: '19970314'
            }
        });

        assert.deepEqual(mergedOverride, {
            billingAddress: {
                street: 'Main Street 1'
            },
            contactDetails: {
                emailAddress: 'basket@example.com',
                phoneNumber: '+49111111111'
            },
            personalInformation: {
                name: {
                    firstName: 'Jason',
                    surname: 'Null'
                },
                dateOfBirth: '19970314'
            }
        });
    });

    it('should preserve untouched SFCC billing address fields for partial overrides', function () {
        global.request = {
            locale: 'de_DE'
        };

        var model = Customer.fromBasket({
            customerEmail: 'basket@example.com',
            billingAddress: new Proxy({
                address1: 'Bernburger',
                address2: 'No: 23',
                city: 'Berlin',
                postalCode: '12689',
                countryCode: {
                    value: 'DE'
                },
                stateCode: 'BE',
                phone: '+49123456789',
                firstName: 'John',
                lastName: 'Doe'
            }, {
                set: function () {
                    throw new Error('strict object mutated');
                }
            }),
            customer: {
                profile: {
                    customerNo: '20001'
                }
            }
        }, {
            billingAddress: {
                city: 'Hamburg'
            }
        });

        var payload = model.toRequest();

        assert.equal(payload.billingAddress.street, 'Bernburger');
        assert.equal(payload.billingAddress.additionalInfo, 'No: 23');
        assert.equal(payload.billingAddress.city, 'Hamburg');
        assert.equal(payload.billingAddress.zip, '12689');
        assert.equal(payload.billingAddress.countryCode, 'DE');
        assert.equal(payload.billingAddress.state, 'BE');
    });

});
