import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/cli/test/bun-jest-takes-its-path-alone.test.ts",
  "test/js/bun/test/expect-extend-matcher-utils-throw.test.ts",
  "test/js/bun/test/expect-stack-overflow-crash.test.ts",
  "test/js/bun/test/expect-symbol-toPrimitive-crash.test.ts",
  "test/js/bun/test/expect-unreaachable.test.ts",
  "test/js/bun/test/expect.test.js",
  "test/js/bun/test/expect/huge-failure-message.test.ts",
  "test/js/bun/test/expect/toHaveReturnedWith.test.ts",
  "test/js/bun/test/pretty-format-overridden-size.test.ts",
  "test/js/bun/test/require-bun-test-ignores-bun-jest.test.ts",
);
