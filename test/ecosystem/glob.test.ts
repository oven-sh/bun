import { runTests } from "./harness";

runTests({
  package: "glob",
  repository: "https://github.com/isaacs/node-glob",
  ref: "v10.3.10",
  paths: ["test/*.ts"],
  runner: "tap",
  todo: true,
  // t.pipe is not a function (test runner)
  // expect() must be called in a test
});
