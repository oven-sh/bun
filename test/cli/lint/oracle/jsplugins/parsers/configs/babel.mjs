import babel from "@babel/eslint-parser";
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.all,
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parser: babel,
      parserOptions: { requireConfigFile: false, babelOptions: { presets: ["@babel/preset-react"] } },
    },
  },
];
