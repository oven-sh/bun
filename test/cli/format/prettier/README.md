# Prettier's tests

`bun format` prints what [Prettier](https://github.com/prettier/prettier) prints. `bundle.zst` holds `tests/format/{js,jsx,typescript,json,css,less,scss,graphql,yaml,markdown,mdx,handlebars,misc}` of Prettier, and `{html,vue,angular,lwc,mjml,flow}`, which are run only if `--languages` names them, unchanged: the inputs, and the snapshots
(`__snapshots__/format.test.js.snap`), which also say with which options each input is formatted. One file after the other, compressed with zstd: see `../bundle.ts`. `sync.ts` writes it, and `version.json` says from which
commit. Prettier is under the MIT license: `LICENSE`.

Two things are in Prettier's `format.test.js` files and in no snapshot, so `sync.ts` runs those files with a `runFormatTest` that takes notes, and writes them in the form of the other fixtures:

- the expected output of a snippet, where it is next to the input: `<directory>/inline-outputs/__snapshots__/format.test.js.snap`
- the text of a snippet that has to be rejected: `<directory>/rejected-snippets/<number>.<extension>`, with a snapshot file that says so

```sh
# The files, to look at them or to run them from a directory
bun test/cli/format/prettier/sync.ts --extract "" /tmp/prettier-fixtures
bun test/cli/format/prettier/sync.ts --extract js/arrows /tmp/prettier-fixtures
# Another version of Prettier
bun test/cli/format/prettier/sync.ts <path to a checkout at the tag, after `yarn install` in it>
# All of Prettier's checks on all of them: from the bundle, or from a directory, which can be `tests/format` of a checkout
bun-lint format conformance <(zstd -dc test/cli/format/prettier/bundle.zst) [--languages=js,jsx,..] [--filter=text] [--table] [--report=dir]
bun-lint format conformance /tmp/prettier-fixtures
# In a debug or a canary build of Bun
bun bd test test/cli/format/conformance.test.ts
```

`bun-lint` is the crate `bun_lint_standalone`. The runner is the crate `bun_format_conformance` (`src/format/conformance`): it says what is checked, and what is left out and why.

`expected.txt` is what it printed when the file was last written: the checks that fail, the totals, and what is not run and why. The test is red if a check fails that is not in it, or if what is not run is not what it says. A check that is in it and passes by now is no reason to be red, so a fix need not come with the file. To write it again:

```sh
bun-lint format conformance <(zstd -dc test/cli/format/prettier/bundle.zst) > test/cli/format/prettier/expected.txt
```
