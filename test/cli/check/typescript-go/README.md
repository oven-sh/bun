# TypeScript's tests, with TypeScript's results

`bun check` reports what [TypeScript](https://github.com/microsoft/TypeScript) 7.1 reports. `bundle.zst` holds the tests
that TypeScript runs on itself and what it expects of them, unchanged, one file after the other, compressed with zstd.
`sync.ts` writes it, and `version.json` says from which commit. The paths in it are those of a checkout:

| Path                                | What                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `/tsc/testdata/tests/cases`         | the compiler and conformance tests                                       |
| `/tsc/testdata/tests/lib`           | library files that some of them name                                     |
| `/tsc/testdata/baselines/reference` | what is expected of each test, see below. `names.txt`: all the baselines |
| `/tsc/internal/bundled/libs`        | `lib.*.d.ts`, as that version of TypeScript has them                     |

The files in `../conformance` run them all and compare byte for byte. CI limits the time of a test file, so each file runs an eighth of the tests, in one process:

| Baseline            | What                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `<test>.errors.txt` | the errors                                                                                 |
| `<test>.types`      | the type of every expression and name                                                      |
| `<test>.symbols`    | the symbol of every name, with its declarations                                            |
| `<test>.js`         | the files that are emitted. The declaration files in it are compared, the JavaScript isn't |
| `<test>.trace.json` | what `traceResolution` logs                                                                |
| `<test>.contentmapper` | the files that content mappers produce, and the errors in them                          |

TypeScript also has `.js.map` and `.sourcemap.txt` baselines. They aren't in the bundle.

One test is skipped. `deprecatedReferenceInEnumComputedNameNoFlake` expects TS6385, "'oldValue' is deprecated". That's a
suggestion for editors, which `tsc` doesn't print, and `bun check` makes no suggestions about deprecated declarations.

```sh
bun bd test test/cli/check/conformance
# One test, or all whose path contains the text
ONLY=arrowFunctionErrorSpan bun bd test test/cli/check/conformance
# The test and what is expected of it, as files
bun test/cli/check/typescript-go/sync.ts --extract arrowFunctionErrorSpan
# Another version of TypeScript
bun test/cli/check/typescript-go/sync.ts v7.1-beta
```

Some tests are about byte order marks, line endings and malformed text, so every file in the bundle is preceded by its
length in bytes.
