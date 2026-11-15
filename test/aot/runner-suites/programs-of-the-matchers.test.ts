import { totalmem } from "node:os";
import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/cli/test/bun-jest-takes-its-path-alone.test.ts",
  "test/js/bun/test/expect-extend-matcher-utils-throw.test.ts",
  "test/js/bun/test/expect-stack-overflow-crash.test.ts",
  "test/js/bun/test/expect-symbol-toPrimitive-crash.test.ts",
  "test/js/bun/test/expect-unreaachable.test.ts",
  "test/js/bun/test/expect.test.js",
  // It takes several gigabytes and skips itself on a machine with under ten, as some of CI's are. A suite that starts no compiled run shows nothing, so it is not asked there.
  ...(totalmem() < 10 * 1024 ** 3 ? [] : ["test/js/bun/test/expect/huge-failure-message.test.ts"]),
  "test/js/bun/test/expect/toHaveReturnedWith.test.ts",
  "test/js/bun/test/pretty-format-overridden-size.test.ts",
);
