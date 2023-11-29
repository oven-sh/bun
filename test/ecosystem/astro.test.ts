import { runTests } from "./harness";

runTests({
  package: "astro",
  repository: "https://github.com/withastro/astro",
  ref: "astro@3.6.3",
  paths: ["packages/astro/test/**/*.spec.js"],
  runner: "jest",
  todo: true, // error: workspace dependency "astro-benchmark" not found
});
