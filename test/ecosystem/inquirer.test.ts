import { runTests } from "./harness";

runTests({
  package: "inquirer",
  repository: "https://github.com/SBoudrias/Inquirer.js",
  ref: "@inquirer/core@5.1.0",
  paths: ["packages/**/*.test.mts"],
  runner: "vitest",
  todo: true, // hangs
});
