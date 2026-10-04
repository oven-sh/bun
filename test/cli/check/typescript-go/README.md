# TypeScript's tests, with typescript-go's results

`bun check` reports what [typescript-go](https://github.com/microsoft/typescript-go) reports. `bundle.txt` holds the
tests that typescript-go runs on itself and the errors it expects, unchanged, one file after the other. `sync.ts` writes
it, and `version.json` says from which commits. The paths in it are those of a typescript-go checkout:

| Path                                  | What                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `/_submodules/TypeScript/tests/cases` | TypeScript's compiler and conformance tests                              |
| `/_submodules/TypeScript/tests/lib`   | library files that some of them name                                     |
| `/testdata/tests/cases`               | typescript-go's own tests                                                |
| `/testdata/baselines/reference`       | `<test>.errors.txt`: the errors expected. `names.txt`: all the baselines |
| `/internal/bundled/libs`              | `lib.*.d.ts`, as that version of typescript-go has them                  |

`../conformance.test.ts` runs them all and compares byte for byte.

```sh
bun bd test test/cli/check/conformance.test.ts
# One test, or all whose path contains the text
ONLY=arrowFunctionErrorSpan bun bd test test/cli/check/conformance.test.ts
# The test and what is expected of it, as files
bun test/cli/check/typescript-go/sync.ts --extract arrowFunctionErrorSpan
# Another version of typescript-go
bun test/cli/check/typescript-go/sync.ts typescript/v7.0.2
```

Do not edit `bundle.txt` by hand: every file in it is preceded by its length in bytes, and some tests are about byte
order marks, line endings and malformed text.
