import { runTests } from "./harness";

runTests({
  package: "elysia",
  repository: "https://github.com/elysiajs/elysia",
  ref: "0.7",
  paths: ["test/**/*.ts"],
  runner: "jest",
});
