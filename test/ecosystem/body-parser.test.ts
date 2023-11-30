import { runTests } from "./harness";

runTests({
  package: "body-parser",
  repository: "https://github.com/expressjs/body-parser",
  ref: "1.20.2",
  paths: ["test/*.js"],
  runner: "mocha",
  todo: true, // crashes
});
