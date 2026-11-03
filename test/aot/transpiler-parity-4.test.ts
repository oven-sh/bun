import { parity } from "./transpiler-parity-cases";

parity([
  "test/bundler/transpiler/template-literal.test.ts",
  "test/bundler/transpiler/decorator-metadata.test.ts",
  "test/cli/run/esm-defineProperty.test.ts",
]);
