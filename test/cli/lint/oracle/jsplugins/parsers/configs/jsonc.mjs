import jsonc from "eslint-plugin-jsonc";

export default [
  ...jsonc.configs["flat/recommended-with-jsonc"],
  {
    files: ["**/*.json", "**/*.jsonc", "**/*.json5"],
    rules: {
      "jsonc/indent": ["error", 2],
      "jsonc/sort-keys": "error",
      "jsonc/key-spacing": "error",
      "jsonc/comma-dangle": "error",
      "jsonc/quotes": "error",
    },
  },
];
