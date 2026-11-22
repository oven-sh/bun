# Files that are already formatted

`src/format/js/settled` has the rules of `src/format/js/print` a second time. If a rule changes in one place only, `bun fmt` passes code that it has to change. `settled.test.ts` is there to notice.

- `cases.ts`: what `--check` passes, what it fails, and what is an error. Also lists of expressions, types and places for them, of which all combinations are tried.
- `corpus.zst`: statements as `bun fmt` has printed them at some time, each under the name of its options (`optionSets` in `run.ts`). They are from the inputs of `../prettier`, `../oxfmt`, `../own` and `cases.ts`, and from this repository. The licenses of Prettier and oxc are next to their inputs.
- `mutate.ts`: small changes to those. `SEED=2` makes others, `SHOW=50` shows more failures.
- `bun fmt --run-settled-tests` (`src/format/conformance/settled.rs`) formats both ways.

**Nothing is ever taken out of `corpus.zst`.** What an earlier version printed is what is in people's repositories, so it is what must not be taken for formatted once a rule has changed.

| failure                                  | what to do                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Formatted, changes`, `Reduced, changes` | The formatter prints something else, and `settled` doesn't know. Change the rule there too, or make it give up. |
| `Formatted, rejects`, `Reduced, rejects` | The same for a syntax error.                                                                                    |
| `Unknown, keeps`, `Reduced, keeps`       | It was recognized before, so this costs time. If that's on purpose, add the path to `given-up.txt`.             |

After a change to the rules, or to the inputs, add what is printed now:

```sh
bun bd test/cli/format/settled/add.ts
```
