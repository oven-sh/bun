import { runTests } from "./harness";

runTests({
  package: "rimraf",
  repository: "https://github.com/isaacs/rimraf",
  ref: "v5.0.5",
  paths: ["test/**/*.ts"],
  runner: "tap",
  todo: true, // Too many errors
});
