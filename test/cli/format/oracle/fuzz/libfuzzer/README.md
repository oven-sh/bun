# Coverage-guided fuzzers

The fuzzers one directory up make texts that look like a language and compare with Prettier. These feed bytes: [libFuzzer](https://llvm.org/docs/LibFuzzer.html) changes an input, sees which code that reaches, and keeps what reaches something new. The code is compiled with overflow checks and debug assertions, which a release build of Bun does not have, and with AddressSanitizer if asked for. None runs in CI.

The crate is not a member of Bun's workspace. It links the crates that it tests without the rest of Bun, as `bun-lint` does: `src/sema/standalone/native.rs` stands in for Bun's C and C++ side, `mimalloc.rs` for mimalloc.

| target | what runs | the first byte chooses |
| --- | --- | --- |
| `html` | `bun format` | HTML, Vue, Angular, LWC, MJML, the four kinds of expressions of Angular, and the extensions that stand for them |
| `embedded` | `bun format` | where the text is: in `` html`..` ``, `/* HTML */`, `@Component({ template })`, `` css`..` ``, `` graphql`..` ``, `` markdown`..` ``, in a block of code or the front matter of Markdown, in a block or an attribute of Vue, HTML or Angular (`PLACES` in `format.rs`). In a template the bytes 1, 2 and 3 are substitutions |
| `handlebars`, `yaml`, `graphql` | `bun format` | |
| `css` | `bun format` | CSS, SCSS, Less |
| `markdown` | `bun format` | Markdown, MDX |
| `json` | `bun format` | JSON, JSON5, JSONC, `json-stringify`, `package.json`, `.prettierrc` |
| `js` | `bun format`: parse, bind, print, parse again, compare | the extension, and `flow`, `babel-flow`, `babel-ts`, `typescript`, `babel` |
| `imports` | `bun format` with what plugins do: imports sorted as `@trivago` / `@ianvs/prettier-plugin-sort-imports`, `prettier-plugin-organize-imports` and oxfmt sort them, JSDoc comments formatted as oxfmt does | where the text is: a file, a block of code in Markdown or MDX, the top of MDX, a script in Vue or HTML (`PLACES_OF_IMPORTS` in `format.rs`), and which of sixteen sets of options (`EXTRAS`) |
| `options` | the same, and the first line of the text is the options, as they are in a `.prettierrc` or an `.oxfmtrc.json`: regular expressions, globs, groups | where the text is |
| `config` | `bun format --check .` and `bun lint .` as a whole, in a small project in memory whose configuration file is the text: how `.prettierrc` in JSON, JSON5, YAML and TOML, `package.json`, `.editorconfig`, ignore files, `.oxfmtrc.json`, `.oxlintrc.json` and `.eslintrc` are found, read and applied, overrides, the options of rules. After a line `=====`: the text of `a.ts`. No program is run, no plugin is loaded | the name of the file (`FILES` in `config.rs`) |
| `regex` | `bun_lint::regex::Regex`, which is `RegExp` for the patterns in the options of rules and in `importOrder`: the text is a pattern, a line break, and what is searched. `test`, `find`, all matches, `split`, `replace` and `source` have to agree with `exec`. `regex-oracle.mjs` asks the `RegExp` of Node.js | nothing. The first eight flags of the input: `d g i m s u v y` |
| `glob` | `bun_lint::linter::Glob`, which is minimatch with `dot`: the text is a pattern, a line break, and a path. `glob-oracle.mjs` asks minimatch | |
| `readers` | Bun's two readers of JSON, as long as there are two, with each of seven sets of options: `bun_lint::json::comparison::describe` says the same of both | |
| `md` | `bun_md`, which is behind `Bun.markdown`: Markdown to HTML | |
| `lint` | `bun lint`: every rule that needs neither types nor other files, with its default options, the comments that configure rules, and fixes | the extension, the parser, module or script |
| `parser` | `bun_sema_parser` and, except for Flow, the parser that recovers from errors | the extension. The second byte: the dialect |

An input is ten bytes and the text (`Input` in `lib.rs`): the variant, `printWidth` (0: 80), 32 bits of which each sets an option (`FLAGS` in `format.rs`) and the last two ask for `cursorOffset` or `rangeStart` and `rangeEnd`, and two offsets for those. All zero: the defaults.

The formatter is called through `bun_lint_driver::fmt::format_for_tests`, which is what `bun format` does with a file once it has found it and its options, with the checks that it makes on what it has printed.

## What is a finding

| kind | |
| --- | --- |
| `panic` | an index out of range, an overflow, a failed assertion. In Bun a panic ends the process. Named after the place |
| `alarm` | `bun format` says that it has a bug: the document is malformed, or what it has printed is another program |
| `loss` | `bun format` says that what Prettier prints has lost something, and leaves the file alone. Prettier does lose things. Or the check is wrong, or the formatter is |
| `unstable` | what is printed is printed differently when it is formatted again |
| `refuses-its-own` | what is printed is refused when it is formatted again |
| `loss-in-its-own` | what is printed is left alone when it is formatted again, because something would be lost |
| `letter-lost`, `letter-added` | a letter, capital or small, is not as often in what is printed as in the text. No formatter adds or drops one |
| `not-utf8` | the text is UTF-8 and what is printed is not |
| `growth` | what is printed, less the indentation, is more than eight times as long as the text |
| `slow` | more than a second of processor time (`FUZZ_SLOW_MS`) |
| `import-lost`, `import-added`, `import-less-often`, `import-more-often` | see "Steps that move or remove things" |
| `import-removed-though-named`, `rest-changed`, `comment-lost`, `comment-added`, `jsdoc-word-lost`, `word-lost`, `word-added`, .. | the same |
| `refused-only-with-the-step`, `accepted-only-with-the-step` | the same |
| `value-changed`, `value-cannot-be-read` | `json`, `yaml`: Bun's own parser reads another value from what is printed than from the text, or none. In YAML without the blanks at the ends of lines, which Prettier drops, and not with `proseWrap`, with which it changes values |
| `fix-breaks-the-syntax` | `lint`: the text can be parsed, and after the fixes it cannot |
| `accepted`, `different` | `parser`: it parses what the other parser has an error for, or to another tree |

These do not end the process: with `FUZZ_FINDINGS=<directory>` the input is written to `<directory>/<target>/<kind>/<key>`, the smallest that was seen for each key, with a file `.info` next to it that has the name of the file, the flags of the command line, and what was wrong. So a frequent finding does not stand in the way of the next one. Without `FUZZ_FINDINGS` a finding ends the process, which is what libFuzzer needs to minimize an input.

What does end the process is libFuzzer's to report, in `artifacts/`: a stack overflow (deep input has to end in "nested too deeply"), a report of AddressSanitizer, more than 5 seconds, more than 2 GB.

`unstable`, `loss` and `refuses-its-own` are often Prettier's own: it prints `<!dOctYpE html>` for `<!dOctYpE HtMl>` and `<!doctype html>` for that, and reads a NUL as the end of HTML. `triage.ts` asks it.

## Steps that move or remove things

Sorted imports, the sorted keys of a `package.json` and formatted JSDoc comments are the steps that can lose something which the check on what is printed does not see: for the plugins of Prettier it compares the sorted text with what is printed, not the file with the sorted text, and code in another language is not checked at all. So a text is formatted twice, with the step and without it, and the two are compared (`kept.rs`), which leaves out all that the formatter changes by itself:

- A file of JavaScript or TypeScript: the same names are imported from the same modules under the same names, as types or not, with the same attributes. In which statement does not count: imports are merged. The same for `export { .. }`, `export *` and `import a = `. The same comments. All else is the same text in the same order.
- `prettier-plugin-organize-imports` removes what is not used. A name that is nowhere else in the code is not used. One that is can still be unused, if something hides it: `import-removed-though-named` is for the oracle.
- Code in Markdown, MDX, Vue and HTML, and a `package.json`: no word is lost or added.
- JSDoc comments: no word, in small letters, but the names of tags.

With `FUZZ_SABOTAGE=1` the first line of what is printed that imports something is dropped before the checks: they have to notice.

`imports-oracle.mjs` asks the real tools about a whole corpus, which reaches every line that the fuzzer has found a way to:

```sh
FUZZ_RECORD=$W/records FUZZ_FINDINGS=$W/findings $B/fuzz_imports -runs=0 $W/corpus/imports
node imports-oracle.mjs $W/records --prettier=<dir> --organize=<dir> --oxfmt=<dir> --out=$W/differences.jsonl
```

## Commands

```sh
cd test/cli/format/oracle/fuzz/libfuzzer
./build.sh plain        # or asan. Into target/fuzz/<mode> at the root of the repository. Six minutes
B=../../../../../../target/fuzz/plain/x86_64-unknown-linux-gnu/fuzz
W=/somewhere/with/room
bun seeds.ts $W/seeds [directories with more files..]   # Prettier's fixtures, ours, the test cases of the rules
./run.sh $B $W html 3600 12 4096      # an hour, 12 processes, inputs of at most 4096 bytes
./show.sh $B html $W/findings/html/panic/<key>          # the text, the flags, what becomes of it
bun triage.ts $B $W <directory with node_modules/prettier> html
# The smallest input for one finding
FUZZ_ONLY=panic/<key> $B/fuzz_html -minimize_crash=1 -runs=100000 -exact_artifact_path=small $W/findings/html/panic/<key>
# A smaller corpus that reaches the same
mkdir $W/smaller && $B/fuzz_html -merge=1 $W/smaller $W/corpus/html
# Which lines the corpus reaches
./build.sh coverage && ./coverage.sh ../../../../../../target/fuzz/libfuzzer/x86_64-unknown-linux-gnu/coverage $W html src/format/html
```

`run.sh` limits the stack to 4 MB, that of a thread of Bun's pool, which is what formats and lints.

`found/<target>/` has the inputs, made small, that have shown something. They are good first inputs, and after a fix `show.sh` says what has become of them.

`repeats.ts` is not a fuzzer. libFuzzer seldom makes an input that nests 10,000 deep or has 50,000 of something, which is what a recursion without a check or a quadratic loop takes. It repeats every word of a dictionary up to a size, on the fuzzers or on a release build:

```sh
bun repeats.ts $B html 65536 0,1,2,4 8
COMMAND="bun format --check" NAMES=a.js,a.jsx,a.ts,a.tsx SLOW_MS=400 bun repeats.ts $B js 262144 0,1,2,3 8
```

The other way to a recursion without a check: a small stack. `FUZZ_STACK_KB=1024 ./run.sh <binaries with AddressSanitizer> ..`.

## What AddressSanitizer sees here

The crates of the formatter, the linter and the new parser forbid `unsafe`, so there it can only find a bug of the compiler. It is for what they call: `bun_core`, `bun_alloc`, `bun_sema` and `bun_js_parser`, which have `unsafe`.

- It sees every block of the global allocator, which is `malloc` here as in Bun's own builds with AddressSanitizer (`--cfg bun_asan`).
- It sees every block of an arena, which it would not in Bun: there an arena is a heap of mimalloc, whose blocks lie side by side in pages that AddressSanitizer knows nothing about. `mimalloc.rs` makes each a block of `malloc`: reading past the end of one, or using one after its heap is destroyed, is reported. Reading up to 48 bytes before the start of one is not: the list of the heap's blocks is there.
- It does not see Bun's SIMD kernels (Highway, simdutf): plain loops in Rust stand in for them. A kernel that reads past the end of a text is not found here, unless those of Highway are linked: `KERNELS=<directory with the objects> ./build.sh asan`.
- The widths of characters are an approximation of Bun's, so where a line with wide characters breaks can differ from `bun format`.
