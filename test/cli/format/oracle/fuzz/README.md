# Fuzzers

Each makes small programs, formats them with the npm package of Prettier and with `bun-lint format`, and prints what differs. They found what no fixture shows. None runs in CI: they need Prettier.

| file | what it makes |
| --- | --- |
| `expressions-in-parents.ts` | every kind of expression in every kind of parent: parentheses |
| `expressions-layout.ts` | expressions in parents with names of any width: where lines break |
| `calls.ts` | calls, arguments and member chains from a grammar |
| `ternaries.ts` | conditional expressions with `experimentalTernaries` |
| `jsx-children.mjs` | JSX children, for narrow widths |
| `comments-in-expressions.ts`, `comments-in-statements.ts`, `comments-in-types.ts` (+ `-seeds.ts`) | a comment of every form in every gap of small programs |
| `comments-in-chains.ts` | a comment of six forms in every gap of member chains, member accesses and calls, also with parentheses around every prefix of the chain, two comments at once, long names |
| `comments-in-real-code.ts` (+ `-report.ts`) | a comment at every line of statements of real code. It can also compare with oxfmt, in its flavor |
| `line-endings.ts` | fixtures with CRLF and CR |
| `cursor.ts` | the cursor at every offset of real files: `cursorOffset` |
| `graphql.ts` | GraphQL: a comment in every gap, random ranges, options and line endings, tokens taken out or replaced |
| `markdown.ts` | Markdown: snapshot inputs with random changes, or a soup of markers. Compares the output, the syntax tree with its positions, or MDX |
| `markdown-guards.ts` | not a comparison: 102 shapes of Markdown that are slow or nest without end in other parsers, under a limit on time and memory |
| `handlebars/generate.ts` | Handlebars: templates from a grammar, real ones with random changes, or pieces in any order. It only writes them: `against-prettier.ts --accepts` compares, what is rejected included |
| `handlebars/damage.ts` | Handlebars: the templates whose syntax tree, as Prettier compares trees in its own tests, is another one after formatting, and of which `bun format` does not say that it would damage them |
| `handlebars/guards.ts` | not a comparison: 92 shapes of templates that nest without end or take quadratic time in a careless parser or printer, at two sizes, under a limit on time and memory |
| `html/templates.ts` | HTML in the templates of JavaScript: fixtures and small pieces in `` html`..` ``, `/* HTML */` and `@Component({ template })`, with substitutions in every kind of place. It only writes them: `against-prettier.ts --options='{"embeddedHtml":true}'` compares |
| `html/templates-guards.ts` | not a comparison: 30 shapes of templates with HTML that nest without end or take quadratic time in a careless formatter, at two sizes, under a limit on time |
| `mutations.ts` | style sheets (CSS, Less, SCSS), YAML, and style sheets in templates of JavaScript with substitutions: real files with random changes. It only writes them: `against-prettier.ts` compares with the npm package, in a worker that is ended if it hangs |
| `near.ts` | every language: Prettier's fixtures, or real files (`--files`), each a little changed: a token deleted, doubled, swapped with the next, or the text cut off: a file while it is typed. It runs `bun format --write` itself, with its checks, and asks Prettier, or oxfmt (`--oxfmt`), with the defaults or a set of options (`--options`). Two tables: how many have the same bytes, and which check refused what the other tool prints, rightly or not. `bun near.ts --command="bun format" --prettier=<directory> --language=js` (`css`, `yaml`, `graphql`, `json`, `handlebars`, `markdown`, `html`) |
| `two-binaries.ts` | not a fuzzer: the files that two builds format differently, for a change that must not change any output |
| `css-memo-orders.py`, `css-memo-surroundings.py` | not against Prettier: what `css/memo.rs` keeps of declarations must not show. All style sheets on one thread in shuffled orders, and the same declarations in many surroundings, against a build without the memo |
| `each-line.ts` | not a fuzzer: every line of a file on its own, for lists of small programs |
| `libfuzzer/` | not against Prettier: bytes, not texts. Coverage-guided fuzzers (libFuzzer) for every language of the formatter, for the linter and for the parser, compiled with overflow checks, debug assertions and AddressSanitizer. A crate of its own, with its own README |
