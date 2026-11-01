import js from "@eslint/js";
import html from "eslint-plugin-html";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.html", "**/*.htm"],
    plugins: { html },
    languageOptions: { globals: globals.browser, sourceType: "script" },
    rules: { "no-var": "error", eqeqeq: "error", "dot-notation": "error", curly: ["error", "all"] },
  },
];
