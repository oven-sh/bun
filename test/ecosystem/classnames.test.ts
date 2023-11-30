import { runTests } from "./harness";

runTests({
  package: "classnames",
  repository: "https://github.com/JedWatson/classnames",
  ref: "v2.3.2",
  paths: ["tests/*.js"],
  runner: "mocha",
});
