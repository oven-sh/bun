import { runTests } from "./harness";

runTests({
  package: "chalk",
  repository: "https://github.com/chalk/chalk",
  ref: "v5.3.0",
  paths: ["test/*.js"],
  runner: "ava",
});
