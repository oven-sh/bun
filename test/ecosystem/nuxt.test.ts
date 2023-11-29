import { runTests } from "./harness";

runTests({
  package: "nuxt-framework",
  repository: "https://github.com/nuxt/nuxt",
  ref: "v3.8.2",
  paths: ["test/**/*.test.ts"],
  runner: "jest",
  todo: true, // error: workspace dependency "@nuxt/webpack-builder" not found
});
