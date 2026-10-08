# Prettier's tests

`bun format` prints what [Prettier](https://github.com/prettier/prettier) prints. `bundle.zst` holds `tests/format/{js,jsx,typescript,json,css,less,scss,graphql,yaml,markdown,misc}` of Prettier, unchanged: the inputs, and the snapshots
(`__snapshots__/format.test.js.snap`), which also say with which options each input is formatted. One file after the other, compressed with zstd: see `../bundle.ts`. `sync.ts` writes it, and `version.json` says from which
commit. Prettier is under the MIT license: `LICENSE`.

Six of Prettier's `format.test.js` have the expected output next to the input. For those, `sync.ts` writes `<directory>/inline-outputs/__snapshots__/format.test.js.snap`, in the form of the other snapshots.

```sh
# The files, to look at them or to run them from a directory
bun test/cli/format/prettier/sync.ts --extract "" /tmp/prettier-fixtures
bun test/cli/format/prettier/sync.ts --extract js/arrows /tmp/prettier-fixtures
# Another version of Prettier
bun test/cli/format/prettier/sync.ts <path to a checkout at the tag>
# All of Prettier's checks on all of them: from the bundle, or from a directory, which can be `tests/format` of a checkout
bun-lint format conformance <(zstd -dc test/cli/format/prettier/bundle.zst) [--languages=js,jsx,..] [--filter=text] [--table] [--report=dir]
bun-lint format conformance /tmp/prettier-fixtures
# In a debug or a canary build of Bun
bun bd test test/cli/format/conformance.test.ts
```

`bun-lint` is the crate `bun_lint_standalone`. The runner is the crate `bun_format_conformance` (`src/format/conformance`): it says what is checked, and what is left out and why.

`expected.txt` is what it prints: the checks that fail, and the totals. Whoever makes one more pass writes the file again, in the same commit:

```sh
bun-lint format conformance <(zstd -dc test/cli/format/prettier/bundle.zst) > test/cli/format/prettier/expected.txt
```
