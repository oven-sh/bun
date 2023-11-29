import { runTests } from "./harness";

runTests({
  package: "nextjs-project",
  repository: "https://github.com/vercel/next.js",
  ref: "v14.0.3",
  paths: ["test/unit/**/*.test.ts", "test/e2e/**/*.test.ts"],
  runner: "jest",
  todo: true, // fatal: not in a git directory
});
