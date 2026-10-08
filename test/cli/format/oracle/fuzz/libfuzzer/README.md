# Coverage-guided fuzzers

The fuzzers one directory up make texts that look like a language and compare with Prettier. These feed bytes: [libFuzzer](https://llvm.org/docs/LibFuzzer.html) changes an input, sees which code that reaches, and keeps what reaches something new. The code is compiled with overflow checks and debug assertions, which a release build of Bun does not have, and with AddressSanitizer if asked for. None runs in CI.

The crate is not a member of Bun's workspace. It links the crates that it tests without the rest of Bun, as `bun-lint` does: `src/sema/standalone/native.rs` stands in for Bun's C and C++ side, `mimalloc.rs` for mimalloc.

| target | what runs | the first byte chooses |
| --- | --- | --- |
| `html` | `bun format` | HTML, Vue, Angular, LWC, MJML, the four kinds of expressions of Angular |
| `handlebars`, `yaml`, `graphql` | `bun format` | |
| `css` | `bun format` | CSS, SCSS, Less |
| `markdown` | `bun format` | Markdown, MDX |
| `json` | `bun format` | JSON, JSON5, JSONC, `json-stringify`, `package.json`, `.prettierrc` |
| `js` | `bun format`: parse, bind, print, parse again, compare | the extension, and `flow`, `babel-flow`, `babel-ts`, `typescript`, `babel` |
| `md` | `bun_md`, which is behind `Bun.markdown`: Markdown to HTML | |
| `lint` | `bun lint`: every rule that needs neither types nor other files, with its default options, the comments that configure rules, and fixes | the extension, the parser, module or script |
| `parser` | `bun_sema_parser` and the parser that recovers from errors | the extension. The second byte: the dialect |

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
| `not-utf8` | the text is UTF-8 and what is printed is not |
| `growth` | what is printed, less the indentation, is more than eight times as long as the text |
| `slow` | more than a second (`FUZZ_SLOW_MS`) |
| `fix-breaks-the-syntax` | `lint`: the text can be parsed, and after the fixes it cannot |
| `accepted`, `different` | `parser`: it parses what the other parser has an error for, or to another tree |

These do not end the process: with `FUZZ_FINDINGS=<directory>` the input is written to `<directory>/<target>/<kind>/<key>`, the smallest that was seen for each key, with a file `.info` next to it that has the name of the file, the flags of the command line, and what was wrong. So a frequent finding does not stand in the way of the next one. Without `FUZZ_FINDINGS` a finding ends the process, which is what libFuzzer needs to minimize an input.

What does end the process is libFuzzer's to report, in `artifacts/`: a stack overflow (deep input has to end in "nested too deeply"), a report of AddressSanitizer, more than 5 seconds, more than 2 GB.

`unstable`, `loss` and `refuses-its-own` are often Prettier's own: it prints `<!dOctYpE html>` for `<!dOctYpE HtMl>` and `<!doctype html>` for that, and reads a NUL as the end of HTML. `triage.ts` asks it.

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

## What AddressSanitizer sees here

The crates of the formatter, the linter and the new parser forbid `unsafe`, so there it can only find a bug of the compiler. It is for what they call: `bun_core`, `bun_alloc`, `bun_sema` and `bun_js_parser`, which have `unsafe`.

- It sees every block of the global allocator, which is `malloc` here as in Bun's own builds with AddressSanitizer (`--cfg bun_asan`).
- It sees every block of an arena, which it would not in Bun: there an arena is a heap of mimalloc, whose blocks lie side by side in pages that AddressSanitizer knows nothing about. `mimalloc.rs` makes each a block of `malloc`: reading past the end of one, or using one after its heap is destroyed, is reported. Reading up to 48 bytes before the start of one is not: the list of the heap's blocks is there.
- It does not see Bun's SIMD kernels (Highway, simdutf): plain loops in Rust stand in for them. A kernel that reads past the end of a text is not found here.
- The widths of characters are an approximation of Bun's, so where a line with wide characters breaks can differ from `bun format`.
