import { runTests } from "./harness";

runTests({
  package: "clickhouse-js",
  repository: "https://github.com/ClickHouse/clickhouse-js",
  ref: "0.2.6",
  paths: ["packages/client-node/__tests__/unit/**/*.test.ts"],
  runner: "jest",
  todo: true,
  // Cannot find module "@test/utils"
  // expect.toThrowError is not a function
  // TypeError: ES Modules cannot be stubbed (?)
});
