import { parity, theLists } from "./transpiler-parity-cases";

parity([
  "test/bundler/transpiler/decorators.test.ts",
  "test/bundler/transpiler/decorator-metadata.test.ts",
  "test/cli/run/esm-defineProperty.test.ts",
  "test/js/bun/resolve/esModule-annotation.test.js",
]);
theLists();
