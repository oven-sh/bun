import { runTests } from "./harness";

runTests({
  package: "colors",
  repository: "https://github.com/Marak/colors.js",
  ref: "074a0f8ed0c31c35d13d28632bd8a049ff136fb6", // Jan 7 2022
  paths: ["tests/*.js"],
  runner: "script",
  todo: true, // lockfile is too old
});
