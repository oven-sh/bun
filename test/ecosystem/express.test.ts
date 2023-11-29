import { runTests } from "./harness";

runTests({
  package: "express",
  repository: "https://github.com/expressjs/express",
  ref: "2a00da2067b7017f769c9100205a2a5f267a884b", // June 4 2023
  paths: ["test/acceptance/*.js"],
  runner: "mocha",
  todo: true, // Too many errors
});
