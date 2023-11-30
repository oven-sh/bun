import { runTests } from "./harness";

runTests({
  package: "mysql",
  repository: "https://github.com/mysqljs/mysql",
  ref: "dc9c152a87ec51a1f647447268917243d2eab1fd", // Mar 13 2022
  paths: ["test/unit/**/*.js"],
  runner: "utest",
  todo: true, // TypeError: Module is not a function (near '...test...')
});
