import json from "@eslint/json";

const all = Object.fromEntries(Object.keys(json.rules).map(name => [`json/${name}`, "error"]));
export default [
  { files: ["**/*.json"], ignores: ["**/tsconfig*.json"], plugins: { json }, language: "json/json", rules: all },
  { files: ["**/*.jsonc", "**/tsconfig*.json"], plugins: { json }, language: "json/jsonc", rules: all },
  { files: ["**/*.json5"], plugins: { json }, language: "json/json5", rules: all },
];
