'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var References = proxyquire('../../../../cartridges/int_payone_commerce/cartridge/scripts/models/payone/References', {
    '*/cartridge/scripts/payone/PayoneCommonUtils': require('../../../../cartridges/int_payone_commerce/cartridge/scripts/payone/PayoneCommonUtils')
});

describe('References model', function () {
    it('should trim and clip reference values', function () {
        var model = new References({
            merchantReference: '  ord-12345678901234567890-extra  ',
            descriptor: '  12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890-extra  ',
            merchantParameters: '  {"session":"123"}  '
        });
        var payload = model.toRequest();

        assert.equal(payload.merchantReference.length, 20);
        assert.isAtMost(payload.descriptor.length, 256);
        assert.equal(payload.descriptor.indexOf(' '), -1);
        assert.equal(payload.merchantParameters, '{"session":"123"}');
    });
});
