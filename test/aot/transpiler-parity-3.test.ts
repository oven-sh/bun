import { parity } from "./transpiler-parity-cases";

parity([
  "test/bundler/transpiler/ts-use-define-for-class-fields.test.ts",
  "test/bundler/transpiler/template-literal.test.ts",
  "test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts",
  "test/bundler/transpiler/preserve-use-strict-cjs.test.ts",
  "test/bundler/transpiler/ts-import-alias-runs-once.test.ts",
  "test/js/bun/resolve/require-esm-evaluating-cycle.test.ts",
  "test/js/bun/resolve/require-esm-microtask-order.test.ts",
  "test/js/bun/resolve/require-esm-transitive-tla.test.ts",
  "test/cli/run/require-main-in-an-expression.test.ts",
]);
