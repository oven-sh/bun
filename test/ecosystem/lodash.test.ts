import { runTests } from "./harness";

runTests({
  package: "lodash",
  repository: "https://github.com/lodash/lodash",
  ref: "aa18212085c52fc106d075319637b8729e0f179f", // Sep 27 2023
  paths: ["test/*.spec.js"],
  runner: "jest",
  todo: true,
});
