# Fuzzers

They run `bun format` on texts that they make, and ask the npm package of Prettier about each. Neither runs in CI: they need Prettier.

| file | what it makes |
| --- | --- |
| `handlebars/damage.ts` | Handlebars: the templates whose syntax tree, as Prettier compares trees in its own tests, is another one after formatting, and of which `bun format` does not say that it would damage them |
| `near.ts` | every language: Prettier's fixtures, or real files (`--files`), each a little changed: a token deleted, doubled, swapped with the next, or the text cut off: a file while it is typed. It runs `bun format --write` itself, with its checks, and asks Prettier, or oxfmt (`--oxfmt`), with the defaults or a set of options (`--options`). Two tables: how many have the same bytes, and which check refused what the other tool prints, rightly or not. `bun near.ts --command="bun format" --prettier=<directory> --language=js` (`css`, `yaml`, `graphql`, `json`, `handlebars`, `markdown`, `html`) |
