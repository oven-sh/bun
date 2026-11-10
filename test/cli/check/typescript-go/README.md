# TypeScript's tests, with typescript-go's results

`bun check` reports what [typescript-go](https://github.com/microsoft/typescript-go) reports. `bundle.zst` holds the
tests that typescript-go runs on itself and what it expects of them, unchanged, one file after the other, compressed
with zstd. `sync.ts` writes it, and `version.json` says from which commits. The paths in it are those of a typescript-go
checkout:

| Path                                  | What                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `/_submodules/TypeScript/tests/cases` | TypeScript's compiler and conformance tests                              |
| `/_submodules/TypeScript/tests/lib`   | library files that some of them name                                     |
| `/testdata/tests/cases`               | typescript-go's own tests                                                |
| `/testdata/baselines/reference`       | what is expected of each test, see below. `names.txt`: all the baselines |
| `/internal/bundled/libs`              | `lib.*.d.ts`, as that version of typescript-go has them                  |

The files in `../conformance` run them all and compare byte for byte. CI limits the time of a test file, so each file runs an eighth of the tests, in one process:

| Baseline            | What                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `<test>.errors.txt` | the errors                                                                                 |
| `<test>.types`      | the type of every expression and name                                                      |
| `<test>.symbols`    | the symbol of every name, with its declarations                                            |
| `<test>.js`         | the files that are emitted. The declaration files in it are compared, the JavaScript isn't |
| `<test>.trace.json` | what `traceResolution` logs                                                                |

typescript-go also has `.js.map` and `.sourcemap.txt` baselines. They aren't in the bundle.

`bun check` reports TS2875 where TypeScript 7.1 does: at the first tag in the text of the file, and not where a checker
first asks. Four tests show the difference: `commentsOnJSXExpressionsArePreserved`,
`jsxJsxsCjsTransformKeyPropCustomImport`, `jsxJsxsCjsTransformKeyPropCustomImportPragma` and
`tsxSpreadChildrenInvalidType`. Their eleven `.errors.txt` with that error are those of typescript-go
89d5d5b2849a0db0957065889ca58536fa6d2e4a. A sync with an older version brings the old ones back.

In a union, `bun check` has bigint literals in the order of their values, as TypeScript 7.1 has them. In 7.0 the one
that a checker creates first comes first. Two tests show the difference: `parseBigInt.types`, `parseBigInt.errors.txt`
and `temporal.types` are those of microsoft/TypeScript 5237fd46890956e4bb8177a1a05dcd69e4166560. A sync with an older
version brings the old ones back.

`bun check` measures the variances of a cycle of generic types from the cycle's first-declared type, as TypeScript 7.1
does. In 7.0 the result depends on which type is compared first. One test shows the difference:
`classVarianceResolveCircularity2.errors.txt` and `classVarianceResolveCircularity2.types` are those of
microsoft/TypeScript 5237fd46890956e4bb8177a1a05dcd69e4166560. A sync with an older version brings the old ones back.

At 100 nested comparisons `bun check` assumes that the two types are related, as TypeScript 7.1 does. 7.0 gives up
there and reports TS2321, and what it caches then depends on which comparison came first. One test shows the
difference: `excessivelyDeepConditionalTypes` has no `.errors.txt`, as in typescript-go
89d5d5b2849a0db0957065889ca58536fa6d2e4a. A sync with an older version brings it back.

```sh
bun bd test test/cli/check/conformance
# One test, or all whose path contains the text
ONLY=arrowFunctionErrorSpan bun bd test test/cli/check/conformance
# The test and what is expected of it, as files
bun test/cli/check/typescript-go/sync.ts --extract arrowFunctionErrorSpan
# Another version of typescript-go
bun test/cli/check/typescript-go/sync.ts typescript/v7.0.2
```

Some tests are about byte order marks, line endings and malformed text, so every file in the bundle is preceded by its
length in bytes.
