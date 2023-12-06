import { runTests } from "./harness";

runTests({
  package: "@vitejs/vite-monorepo",
  repository: "https://github.com/vitejs/vite",
  ref: "v5.0.3",
  paths: ["packages/create-vite/__tests__/**/*.spec.ts", "packages/vite/src/node/__tests__/**/*.spec.ts"],
  runner: "jest",
  todo: true, // error: workspace dependency "vite" not found
});
