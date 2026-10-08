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
| `comments-in-real-code.ts` (+ `-report.ts`) | a comment at every line of statements of real code. It can also compare with oxfmt, in its flavor |
| `line-endings.ts` | fixtures with CRLF and CR |
