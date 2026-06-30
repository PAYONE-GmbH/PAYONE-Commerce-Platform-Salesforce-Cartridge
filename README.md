# Payone Commerce SFCC B2C Cartridge

## :hammer: Requirements
Node.js `>=18` is required.

When working across multiple Node.js projects, use **NVM** to manage different Node.js versions.

- Linux/macOS: https://github.com/nvm-sh/nvm
- Windows: https://github.com/coreybutler/nvm-windows

---

## :one: Getting Started
- Clone this repository.
- Run `npm install` to install dependencies.
- Run `npm run lint:js` to run the JavaScript linter.
- Run `npm run lint:css` to run the SCSS/CSS linter.
- Run `npm run lint:isml` to run the ISML linter.
- Run `npm run watch` to start the development build with file watching.
- Run `npm run build` to compile static files for production.

⚠️ By default, only these cartridges are expected in the compilation workflow:

- `bm_payone_commerce`
- `int_payone_commerce`

If additional cartridges need to be compiled, update the `cartridges` array in `package.json`.

---

## :paperclip: Required Tools
Use **Visual Studio Code** with these extensions:

1. [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) — lint JavaScript
2. [Stylelint](https://marketplace.visualstudio.com/items?itemName=stylelint.vscode-stylelint) — lint CSS/SCSS/Less
3. [ISML Linter](https://marketplace.visualstudio.com/items?itemName=fabiowquixada.vscode-isml-linter) — lint ISML
4. (Optional) [Path Intellisense](https://marketplace.visualstudio.com/items?itemName=christian-kohler.path-intellisense)
5. (Optional) [vscode-icons](https://marketplace.visualstudio.com/items?itemName=vscode-icons-team.vscode-icons)

---

## :postal_horn: Code Deployment and Debugging

Create a `dw.json` file in the project root:

```json
{
    "hostname": "your_sandbox",
    "version": "your_version",
    "username": "your_username",
    "cartridges": "cartridges",
    "password": "your_password"
}
```

Create `.vscode/launch.json` for SFCC debugging:

```json
{
    "configurations": [
        {
            "type": "prophet",
            "request": "launch",
            "name": "SFCC Debugger",
            "hostname": "your_sandbox",
            "username": "your_username",
            "password": "your_password",
            "codeversion": "your_version",
            "cartridgeroot": "cartridges",
            "workspaceroot": "${workspaceRoot}"
        }
    ]
}
```

---

## :toolbox: Testing
Run unit tests:

```bash
npm run test
```
