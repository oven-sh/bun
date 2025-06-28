A good deal of parallel test cases can be run directly via `bun <filename>`.
However, some newer cases use `node:test`.

Files in this directory need to be run with `bun test <filename>`. The
`node:test` module is shimmed via a require cache hack in
`test/js/node/harness.js` to use `bun:test`.  Note that our test runner
(`scripts/runner.node.mjs`) checks for `needs-test` in the names of test files,
so don't rename this folder without updating that code.
