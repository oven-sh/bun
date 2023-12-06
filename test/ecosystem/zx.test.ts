import { runTests } from "./harness";

runTests({
  package: "zx",
  repository: "https://github.com/google/zx",
  ref: "7.2.3",
  paths: ["test/*.test.js"],
  runner: "uvu",
  cmds: [["bun", "run", "build"]],
  todo: true, // Too many problems
});
