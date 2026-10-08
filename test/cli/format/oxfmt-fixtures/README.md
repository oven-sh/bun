# oxfmt's fixtures

`formatter/` is `crates/oxc_formatter/tests/fixtures` of [oxc](https://github.com/oxc-project/oxc) (MIT license, Copyright (c) 2024-present VoidZero Inc. & Contributors): the inputs, their `options.json`, and
oxfmt's own snapshots (`*.snap`).

Every input is formatted with each set of options of the nearest `options.json`, at `printWidth` 80 and 100, as oxc's test harness does.

- `*.prettier.snap`, next to each input, is what Prettier 3.9.9 prints: that is what `bun format` has to print.
- `*.snap` is what oxfmt prints: that is what `bun format` has to print for whoever has an `.oxfmtrc.json` (`flavor: oxfmt`).

```sh
bun test/cli/format/oracle/oxfmt-fixtures.ts record --prettier=<directory with node_modules/prettier>   # writes *.prettier.snap
bun test/cli/format/oracle/oxfmt-fixtures.ts run --bin=<bun-lint> [--list]
```
