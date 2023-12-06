import { runTests } from "./harness";

runTests({
  package: "commander",
  repository: "https://github.com/tj/commander.js",
  ref: "v11.1.0",
  paths: ["tests/*.test.js"],
  runner: "jest",
  todo: true, // ASSERTION FAILED: !m_errorInfoMaterialized
});
