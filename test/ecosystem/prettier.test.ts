import { runTests } from "./harness";

runTests({
  package: "prettier",
  repository: "https://github.com/prettier/prettier",
  ref: "3.1.0",
  paths: ["tests/unit/*.js"],
  runner: "jest",
});
