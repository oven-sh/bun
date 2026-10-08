# Inputs of our own

Small programs on which `bun format` once differed from Prettier, and which no test of Prettier or of oxfmt has: most were found in real code. They are in the form of oxfmt's tests (`../oxfmt/README.md`), as plain files:

- `cases/**/<name>.input`: the input. `<name>` says what language it is. `.input` keeps everything else from taking it for code.
- `<name>.prettier.snap`: what Prettier prints, which is what `bun format` has to print.
- `<name>.snap`: what oxfmt prints, which is what it has to print for whoever has an `.oxfmtrc.json`.
- `options.json`: the sets of options for the inputs of a directory. Each is run at `printWidth` 80 and 100 too.

To add one, write the input and run `sync.ts`, which asks both:

```sh
bun test/cli/format/own/sync.ts <directory with node_modules/prettier> <directory with node_modules/.bin/oxfmt>
```

`expected.txt` is what the runner prints: the outputs that differ, and the totals. `../conformance.test.ts` runs it.
