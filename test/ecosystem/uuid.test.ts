import { runTests } from "./harness";

runTests({
  package: "uuid",
  repository: "https://github.com/uuidjs/uuid",
  ref: "v9.0.1",
  paths: ["test/unit/*.test.js"],
  runner: "jest",
});
