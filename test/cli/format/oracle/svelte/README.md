# Svelte: the judges

Not run by CI: they need the packages, and some of them a harness.

- `make-fixtures.ts`: writes `test/cli/format/svelte/cases.json` again: what Prettier 3.9.9 with prettier-plugin-svelte 4.1.1, and oxfmt 0.72, print for its inputs.
- `generate.cjs <directory> <count> [<seed>]`: components for the two below.
- `against-plugin.ts <bun> <packages> <directory> [<options>]`: `bun format` against the plugin, file by file. On 7,147 real components: 7,043 the same, 97 refused by both, 4 that the plugin damages, 3 that only it refuses.
- `trees.cjs <bun-lint> <packages> <directory>`: the parser against `svelte/compiler`: the trees, and what is refused with which code and where.
- `verify-mutants.ts <bun-lint> <directory> [<seed>]`: takes a word, an attribute, a tag, an element .. out of what is printed, and asks the check before writing whether it notices.

**An oracle has to repair the plugin after every file.** Its `trim` can empty the array that is Prettier's `literalline`: from then on no preformatted or ignored text of the process has line breaks. With `svelteSortOrder: "none"` it does not reset what `<!-- prettier-ignore -->` has set, so a file that ends with one makes the next come out raw.
