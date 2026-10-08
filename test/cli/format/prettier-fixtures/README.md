# Prettier's fixtures

`tests/format/{js,jsx,typescript,json,misc,css,less,scss}` of [Prettier](https://github.com/prettier/prettier) at the tag in `VERSION` (MIT license, see `LICENSE`): the inputs and the snapshots (`__snapshots__/format.test.js.snap`), which also
say with which options each input is formatted. The `format.test.js` files are left out, and `js/tab-width/nested-functions.spec.js`, which `bun test` would take for a test: its text is in the snapshot.

```sh
bun-lint format conformance test/cli/format/prettier-fixtures [--languages=js,jsx,..] [--filter=text] [--verbose] [--report=dir]
```

`src/lint/standalone/format_cmd/conformance.rs` says what is checked and what is left out.
