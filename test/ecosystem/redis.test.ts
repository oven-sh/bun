import { runTests } from "./harness";

runTests({
  package: "redis",
  repository: "https://github.com/redis/node-redis",
  ref: "redis@4.6.11",
  paths: ["packages/client/lib/**/*.spec.ts"],
  runner: "mocha",
  todo: true, // https://github.com/oven-sh/bun/issues/7360
});
