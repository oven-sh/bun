import { runTests } from "./harness";

runTests({
  package: "underscore",
  repository: "https://github.com/jashkenas/underscore",
  ref: "1.13.6",
  paths: ["test/*.js"],
  runner: "qunit",
  todo: true, // Too many errors
});
