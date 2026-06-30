"use strict";

const fse = require("fs-extra");
const glob = require("glob");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const minimatch = require("minimatch");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const autoprefixer = require("autoprefixer");
const pkg = require("./package.json");
const webpack = require("webpack");

const bootstrapPackages = {
    Alert: "exports-loader?Alert!bootstrap/js/src/alert",
    Carousel: "exports-loader?Carousel!bootstrap/js/src/carousel",
    Collapse: "exports-loader?Collapse!bootstrap/js/src/collapse",
    Modal: "exports-loader?Modal!bootstrap/js/src/modal",
    Scrollspy: "exports-loader?Scrollspy!bootstrap/js/src/scrollspy",
    Tab: "exports-loader?Tab!bootstrap/js/src/tab",
    Util: "exports-loader?Util!bootstrap/js/src/util"
};

/**
 * @constructor
 */
class MiniCssExtractPluginCleanup {
    apply(compiler) {
        compiler.hooks.compilation.tap("MiniCssExtractPluginCleanup", (compilation) => {
            compilation.hooks.afterProcessAssets.tap("MiniCssExtractPluginCleanup", () => {
                Object.keys(compilation.assets)
                    .filter((asset) => {
                        return ["*/css/**/*.js", "*/css/**/*.js.map"].some((pattern) => {
                            return minimatch(asset, pattern);
                        });
                    })
                    .forEach((asset) => {
                        delete compilation.assets[asset];
                    });
            });
        });
    }
}

/**
 * Gets all the files in given fullPath & subdirectories
 * @param {string} fullPath Path to traverse
 * @returns {Array} Files
 */
function throughDirectory(fullPath) {
    let files = [];
    fs.readdirSync(fullPath).forEach(file => {
        const absolutePath = path.join(fullPath, file);
        if (fs.statSync(absolutePath).isDirectory()) {
            const filesFromNestedFolder = throughDirectory(absolutePath);
            filesFromNestedFolder.forEach(fileN => {
                files.push(fileN);
            });
        } else if (absolutePath.endsWith(".js") && !absolutePath.includes("lib")) return files.push(absolutePath); // Take js files and do not try to bundle libs which is already bundled.
    });
    return files;
}

/**
 * @param {Object} env Environment defining development or production
 * @param {string} cartridge Cartridge Name
 * @returns {Object} Bundle for js
 */
function getJSBundle(env, cartridge) {
    const subPath = "cartridge/client";
    const clientPath = path.resolve(__dirname, "cartridges", cartridge, subPath);

    const bundle = {};

    if (env.production) {
        bundle.mode = "production";
    } else {
        bundle.mode = "development";
    }

    bundle.entry = {};
    bundle.resolve = {};
    bundle.name = "js";

    if (!fse.existsSync(clientPath)) {
        console.log(`${chalk.blue.bold(`[INFO-JS] [${cartridge}]`)} Client path does not exist, skipping...`);
        return bundle;
    }

    let entries = [];

    entries = throughDirectory(path.resolve(clientPath).replace(/\\/g, "/"));

    entries.forEach((f) => {
        const key = path.join(path.dirname(path.relative(clientPath, f)), path.basename(f, ".js"));
        bundle.entry[key] = f;
    });

    if (Object.keys(bundle.entry).length === 0) {
        console.log(`${chalk.blue.bold(`[INFO-JS] [${cartridge}]`)} No JS files to compile, skipping...`);
        return bundle;
    }

    const outputPath = path.resolve(__dirname, "cartridges", cartridge, "cartridge/static");
    bundle.output = {
        path: outputPath,
        filename: "[name].js"
    };

    bundle.resolve.alias = {
        root: __dirname,
        cartridges: path.resolve(__dirname, "cartridges")
    };

    bundle.module = {
        rules: [
            {
                test: /\\.(js|jsx)$/,
                use: [
                    {
                        loader: "babel-loader",
                        options: {
                            compact: false,
                            babelrc: false,
                            cacheDirectory: true,
                            presets: ["@babel/preset-env"],
                            plugins: ["@babel/plugin-proposal-object-rest-spread"],
                            sourceType: "unambiguous"
                        }
                    }
                ]
            }
        ]
    };

    bundle.plugins = [
        new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: [path.resolve(__dirname, "cartridges", cartridge, "cartridge/static/*/js")],
            cleanAfterEveryBuildPatterns: []
        }),
        (env.development || env.staging)
            ? new webpack.SourceMapDevToolPlugin()
            : null,
        new webpack.ProvidePlugin(bootstrapPackages)
    ].filter(Boolean);

    bundle.optimization = {
        minimizer: [new TerserPlugin()]
    };

    return bundle;
}

/**
 * @param {Object} env Environment defining development or production
 * @param {string} cartridge Cartridge Name
 * @returns {Object} Bundle for css
 */
function getCSSBundle(env, cartridge) {
    const subPath = "cartridge/client";
    const clientPath = path.resolve(__dirname, "cartridges", cartridge, subPath);
    const bundle = {};

    if (env.production) {
        bundle.mode = "production";
    } else {
        bundle.mode = "development";
    }

    bundle.entry = {};
    bundle.name = "css";

    if (!fse.existsSync(clientPath)) {
        console.log(`${chalk.blue.bold(`[INFO-CSS] [${cartridge}]`)} Client path does not exist, skipping...`);
        return bundle;
    }

    glob.sync(path.resolve(clientPath, "*", "scss", "**", "*.scss").replace(/\\/g, "/"))
        .filter((f) => !path.basename(f).startsWith("_"))
        .forEach((f) => {
            const key = path
                .join(path.dirname(path.relative(clientPath, f)), path.basename(f, ".scss"))
                .split(path.sep)
                .map((pPart, pIdx) => (pIdx === 1 && pPart === "scss" ? "css" : pPart))
                .join(path.sep);

            bundle.entry[key] = f;
        });

    if (Object.keys(bundle.entry).length === 0) {
        console.log(`${chalk.blue.bold(`[INFO-CSS] [${cartridge}]`)} No SCSS files to compile, skipping...`);
        return bundle;
    }

    const outputPath = path.resolve(__dirname, "cartridges", cartridge, "cartridge/static");

    bundle.output = {
        path: path.resolve(outputPath),
        filename: "[name].js"
    };

    bundle.module = {
        rules: [
            {
                test: /\.s[ac]ss$/i,
                use: [
                    { loader: MiniCssExtractPlugin.loader },
                    { loader: "css-loader", options: { url: false } },
                    {
                        loader: "postcss-loader",
                        options: {
                            postcssOptions: {
                                plugins: [autoprefixer]
                            }
                        }
                    },
                    {
                        loader: "sass-loader",
                        options: {
                            sassOptions: {
                                includePaths: [
                                    path.resolve(__dirname, "node_modules")
                                ]
                            }
                        }
                    }
                ]
            },
            {
                test: /\.css$/i,
                use: [
                    { loader: MiniCssExtractPlugin.loader },
                    { loader: "css-loader", options: { url: false } },
                    {
                        loader: "postcss-loader",
                        options: {
                            postcssOptions: {
                                plugins: [autoprefixer]
                            }
                        }
                    }
                ]
            }
        ]
    };

    bundle.plugins = [
        new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: [path.resolve(__dirname, "cartridges", cartridge, "cartridge/static/*/css")],
            cleanAfterEveryBuildPatterns: []
        }),
        new MiniCssExtractPlugin(),
        new MiniCssExtractPluginCleanup(),
        (env.development || env.staging)
            ? new webpack.SourceMapDevToolPlugin()
            : null
    ].filter(Boolean);

    bundle.optimization = {
        minimizer: [
            new CssMinimizerPlugin({
                minimizerOptions: {
                    preset: [
                        "default",
                        {
                            discardComments: { removeAll: true }
                        }
                    ]
                }
            })
        ]
    };

    return bundle;
}

module.exports = (env) => {
    if (!pkg.cartridges) {
        console.error(`package.json does not contain the ${chalk.yellow("cartridges")} entry!`);
        process.exit(1);
    }

    const task = (env && env.compile) || "all";
    const configurations = [];

    if (task === "all" || task === "js") {
        pkg.cartridges.forEach((cartridge) => {
            configurations.push(getJSBundle(env, cartridge));
        });
    }

    if (task === "all" || task === "scss") {
        pkg.cartridges.forEach((cartridge) => {
            configurations.push(getCSSBundle(env, cartridge));
        });
    }

    return configurations;
};
