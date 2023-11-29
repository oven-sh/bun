import { runTests } from "./harness";

runTests({
  package: "yargs",
  repository: "https://github.com/yargs/yargs",
  ref: "v17.7.2",
  paths: ["test/*.cjs"],
  runner: "mocha",
  todo: true, // TypeError: path.charCodeAt is not a function
});
