import { runTests } from "./harness";

runTests({
  package: "got",
  repository: "https://github.com/sindresorhus/got",
  ref: "v14.0.0",
  paths: ["test/*.ts"],
  runner: "ava",
  todo: true,
  // need to implement more of ava runner
  // also crashes
});
