import { runTests } from "./harness";

runTests({
  package: "mysql2",
  repository: "https://github.com/sidorares/node-mysql2",
  ref: "v3.6.5",
  paths: ["test/unit/**/*.js"],
  runner: "utest",
  todo: true, // TypeError: Module is not a function (near '...test...')
});
