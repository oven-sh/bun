import js from "@eslint/js";
import html from "eslint-plugin-html";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.html", "**/*.htm"],
    plugins: { html },
    languageOptions: { globals: globals.browser, sourceType: "script" },
    rules: { semi: "error", "no-var": "error", quotes: ["error", "double"], indent: ["error", 2] },
  },
];
