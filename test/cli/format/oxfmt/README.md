# oxfmt's tests

`bundle.zst` holds `crates/oxc_formatter/tests/fixtures/{js,ts}` and `crates/oxc_formatter_{css,graphql,json,markdown,yaml}/tests/fixtures` of [oxc](https://github.com/oxc-project/oxc), unchanged: the inputs, their `options.json`, and oxfmt's own snapshots (`<input>.snap`). Next to each input,
`<input>.prettier.snap` is what Prettier prints for it, in the same form. One file after the other, compressed with zstd: see `../bundle.ts`. `sync.ts` writes it, and `version.json` says from which commit of oxc and with
which Prettier. oxc is under the MIT license: `LICENSE`.

`jsdoc/fixtures` is `crates/oxc_formatter/tests/jsdoc/fixtures`: pairs of an input and an output, which `sync.ts` writes in the form of the others.

`edge-cases` is `apps/oxfmt/conformance/fixtures/edge-cases`, one language in another: inputs only, so only Prettier judges them.

Every input is formatted with each set of options of the nearest `options.json`, at `printWidth` 80 and 100, as oxc's test harness does.

- `<input>.prettier.snap` is what `bun format` has to print. `oxfmt-ignore` is honoured in both flavors, so Prettier is asked with `prettier-ignore` in its place.
- `<input>.snap` is what it has to print for whoever has an `.oxfmtrc.json` (`flavor: oxfmt`).

```sh
bun-lint format oxfmt-fixtures <(zstd -dc test/cli/format/oxfmt/bundle.zst) [--filter=text] [--report=dir]
# What it printed when it was last written: the outputs that differ, and the totals. The test is red if an output differs that is not in it
bun-lint format oxfmt-fixtures <(zstd -dc test/cli/format/oxfmt/bundle.zst) > test/cli/format/oxfmt/expected.txt
bun test/cli/format/oxfmt/sync.ts --extract ts/union /tmp/oxfmt-fixtures
bun test/cli/format/oxfmt/sync.ts <path to a checkout of oxc> <directory with node_modules/prettier>
```
