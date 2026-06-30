'use strict';

const ISML = require('dw/template/ISML');
const Logger = require('dw/system/Logger').getLogger('PayoneCommerce', 'PayoneCommerce');
var payoneCommerceCheckoutHelper = require("*/cartridge/scripts/helpers/payoneCommerceCheckoutHelper.js");

/**
 * Example template-based hook
 * Should be executed after page head
 * Renders a template result. No value return is expected.
 * Platform hook execution results in all registered hooks being executed, regardless of any return value.
 * For this to execute, a cartridge's hooks.json must register app.template.htmlHead hook.
 * @param {Object} params Parameters from the template
 */
function htmlHead() {
    // NOTE: Template naming is still important, ensure your template is unique
    // Otherwise, an unexpected template may be rendered based on cartridge path
    const templateNameHead = payoneCommerceCheckoutHelper.cartridgeEnabled ? 'hooks/payoneCommerceHeader' : 'hooks/empty';

    try {
        ISML.renderTemplate(templateNameHead);
    } catch (e) {
        Logger.error('Error while rendering template ' + templateNameHead);
    }
}

/**
* Renders the template for the blog link after the footer
*/
function afterFooter() {
    const templateNameFooter = payoneCommerceCheckoutHelper.cartridgeEnabled ? 'hooks/payoneCommerceHeaderFooter' : 'hooks/empty';
    try {
        ISML.renderTemplate(templateNameFooter);
    } catch (e) {
        Logger.error('Error while rendering template ' + templateNameFooter);
    }
}

exports.afterFooter = afterFooter;
exports.htmlHead = htmlHead;
