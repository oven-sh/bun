import js from "@eslint/js";
import * as mdx from "eslint-plugin-mdx";

export default [
  js.configs.recommended,
  { ...mdx.flat, processor: mdx.createRemarkProcessor({ lintCodeBlocks: true }) },
  { ...mdx.flatCodeBlocks, rules: { ...mdx.flatCodeBlocks.rules, "no-var": "error", "prefer-const": "error" } },
];
