import { runTests } from "./harness";

runTests({
  package: "mongodb",
  repository: "https://github.com/mongodb/node-mongodb-native",
  ref: "v6.3.0",
  paths: ["test/unit/**/*.test.ts"],
  runner: "mocha",
  todo: true,
  // SyntaxError: export 'Document' not found in 'bson' (module/import issue?)
  // ReferenceError: Can't find variable: context (test runner issue)
  // error: /bin/sh: ./node_modules/.bin/ts-node: No such file or directory (bun install issue?)
});
