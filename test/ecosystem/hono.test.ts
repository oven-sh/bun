import { runTests } from "./harness";

runTests({
  package: "hono",
  repository: "https://github.com/honojs/hono",
  ref: "v3.10.3",
  paths: ["src/**/*.test.ts"],
  runner: "jest",
  todo: true,
  // expectTypeOf is not a function
  // toThrowError is undefined
  // Can't find variable: caches
});
