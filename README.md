# PAYONE Commerce Platform — Salesforce Commerce Cloud Cartridge

SFCC B2C cartridge for integrating PAYONE Commerce Platform payment methods into Salesforce Commerce Cloud storefronts.

## Cartridges

| Cartridge | Purpose |
|---|---|
| `int_payone_commerce` | Core integration (services, hooks, payment processing) |
| `bm_payone_commerce` | Business Manager extension (configuration, transaction management) |
| `payone_commerce_sfra_changes` | SFRA storefront overlay (checkout, order confirmation) |

## Installation

### Pre-built (recommended)

1. Download the latest release ZIP from [Releases](https://github.com/PAYONE-GmbH/PAYONE-Commerce-Platform-Salesforce-Cartridge/releases)
2. Upload cartridges to your SFCC instance via WebDAV
3. Configure cartridge path and import metadata (see [Integration Guide](documentation/))

### From source

Requires Node.js >= 18.

    git clone https://github.com/PAYONE-GmbH/PAYONE-Commerce-Platform-Salesforce-Cartridge.git
    cd PAYONE-Commerce-Platform-Salesforce-Cartridge
    npm install
    npm run build

Then upload the `cartridges/` directory via WebDAV.

## Configuration

After uploading the cartridges:

1. Add cartridges to your cartridge path in Business Manager:

        bm_payone_commerce:int_payone_commerce:payone_commerce_sfra_changes:app_storefront_base

2. Import metadata from `metadata/`
3. Configure PAYONE credentials in Business Manager under **Merchant Tools > PAYONE Commerce**

For detailed setup instructions, refer to the [Integration Guide](documentation/).

## Supported Payment Methods

- Credit Card (Visa, Mastercard, Amex, etc.)
- PayPal
- Apple Pay
- Google Pay
- SEPA Direct Debit
- Bancontact
- iDEAL
- Paydirekt
- And more — see Integration Guide for the full list

## Development

    npm run build          # compile JS + SCSS
    npm run watch          # development mode with file watching
    npm run lint           # run all linters
    npm run test           # run unit tests

### Debugging

Create `dw.json` in the project root:

    {
        "hostname": "your_sandbox",
        "version": "your_version",
        "username": "your_username",
        "cartridges": "cartridges",
        "password": "your_password"
    }

## Related Packages

- [pcp-server-nodejs-sdk](https://www.npmjs.com/package/pcp-server-nodejs-sdk) — Server-side SDK
- [pcp-client-javascript-sdk](https://www.npmjs.com/package/pcp-client-javascript-sdk) — Client-side SDK

## License

[MIT](LICENSE)