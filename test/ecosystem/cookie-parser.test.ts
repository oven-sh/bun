import { runTests } from "./harness";

runTests({
  package: "cookie-parser",
  repository: "https://github.com/expressjs/cookie-parser",
  ref: "1.4.6",
  paths: ["test/*.js"],
  runner: "mocha",
  todo: true, // times out
});
