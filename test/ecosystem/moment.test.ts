import { runTests } from "./harness";

runTests({
  package: "moment",
  repository: "https://github.com/moment/moment",
  ref: "v2.29.4",
  paths: ["src/test/moment/*.js"],
  runner: "qunit",
  todo: true, // Implement `qunit` runner
});
