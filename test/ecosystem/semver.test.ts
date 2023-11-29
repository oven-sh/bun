import { runTests } from "./harness";

runTests({
  package: "semver",
  repository: "https://github.com/npm/node-semver",
  ref: "6240d75a7c620b0a222f05969a91fdc3dc2be0fb", // Nov 2023
  paths: ["test/functions/*.js", "test/integration/*.js", "test/ranges/*.js", "test/bin/*.js"],
  runner: "tap",
});
