import js from "@eslint/js";
import markdown from "@eslint/markdown";
import tseslint from "typescript-eslint";

export default [
  ...markdown.configs.processor,
  js.configs.recommended,
  { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tseslint.parser } },
  {
    files: ["**/*.md/**"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "warn",
      semi: "error",
      quotes: ["error", "double"],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: "error",
      "object-shorthand": "error",
    },
  },
];
