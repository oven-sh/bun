import { parity } from "./transpiler-parity-cases";

parity([
  "test/bundler/transpiler/ts-import-alias-runs-once.test.ts",
  "test/js/bun/resolve/require-esm-evaluating-cycle.test.ts",
  "test/js/bun/resolve/require-esm-microtask-order.test.ts",
  "test/js/bun/resolve/require-esm-transitive-tla.test.ts",
  "test/cli/run/require-main-in-an-expression.test.ts",
]);
