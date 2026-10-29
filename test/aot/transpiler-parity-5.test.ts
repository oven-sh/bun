import { parity } from "./transpiler-parity-cases";

parity([
  "test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts",
  "test/js/bun/resolve/esModule-annotation.test.js",
  "test/bundler/transpiler/preserve-use-strict-cjs.test.ts",
]);
