# The tests of ESLint, typescript-eslint and the plugins

Every test case of every ESLint core rule, of every typescript-eslint rule and of the rules of other plugins that
`bun lint` has, as JSON, with what **real ESLint** reports for it. They are in `bundle.zst`: one file after the other,
compressed with zstd (see `../../format/bundle.ts`). `sync.ts` writes it, `version.json` says from which versions and
commits, and `licenses/` has the license of each (all MIT).

|                           | version | rules | cases |
| ------------------------- | ------- | ----- | ----- |
| eslint                    | 10.12.0 | 292   | 33977 |
| typescript-eslint         | 8.71.1  | 136   | 29823 |
| eslint-plugin-react-hooks | 7.0.0   | 2     | 1325  |
| eslint-plugin-import      | 2.32.0  | 4     | 597   |
| eslint-plugin-n           | 18.4.1  | 4     | 1530  |
| eslint-plugin-react       | 7.37.5  | 1     | 118   |
| eslint-plugin-prettier    | 5.5.6   | 1     | 448   |
| oxc (oxlint)              | 1.70.0  | 1     | 83    |

The rules of `react-hooks` follow eslint-plugin-react-hooks 7.1.1, which reports the same for all of these cases of 7.0.0.

The commits of eslint and typescript-eslint are `main`, a few commits after the release: the tests come from there. What is
recorded is what the release reports: `lib` of eslint 10.12.0 and the rules of typescript-eslint 8.71.1 as they are published. The cases of a plugin's rule are those of the plugin, of eslint-plugin-import-x for `import`, and
of oxlint's port of the rule: see `extract-plugins.ts`.

The suites of eslint-plugin-import, -react, -regexp and -prettier are recorded with the packages as they are published, and a
rule's suite comes into the bundle when the rule here passes all of it. Some of their cases are files of a project:

- `import-project/` is `tests/files` and `package.json` of eslint-plugin-import, and what of `node_modules` the rules look at.
- `prettier-project/` has the configuration files that the cases of `prettier/prettier` are below, and a `package.json` of
  `prettier` and of `eslint-plugin-prettier`, by whose versions the rule decides whether it answers. The cases are those of the
  plugin's own tests, cases that are written here, and the inputs of Prettier's tests, as they are and formatted and then damaged.
- `/__project__` in a fixture (in the name of a file, an option, a setting, a message, the code) stands for the directory of its
  project. The runner puts `<--projects>/<project>` there when it reads the fixture.
- `a/b.symlink` is the symbolic link `a/b`: what it has is where the link leads. `--extract` makes it.

`more/` has cases from elsewhere in the same format, each with what the same ESLint reports for it:

| directory                | cases | what                                                                                                                 |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `more/reviews`           | 68354 | written while the rules were compared with upstream's code line by line, and minimized from differences on real code |
| `more/oxlint-tsgolint`   | 8728  | the tests that oxlint and tsgolint have for their ports of the rules. What those expect is not used                  |
| `more/typescript-parser` | 30880 | the cases of ESLint's core rules again, parsed by `@typescript-eslint/parser`                                        |

`oxlint/` has the tests of the rules that are ports of the rules in oxlint's own plugins (`unicorn`, `oxc`, `react`, `jsx-a11y`,
`nextjs`, `import`, `promise`, ..): the cases in oxlint's sources, each with what the **executable of oxlint 1.87.0** reports for it.
See `extract-oxlint.ts`. They differ from the others in this:

- A case is linted with an `.oxlintrc.json`: only that rule, the plugins in `plugins`, and what is in `oxlintrc` (`settings`, `env`,
  `globals`).
- A message has no id, and is where the first label of oxlint's diagnostic is. Compared are the number of messages and, of each, the
  text, the line, the column, the end line and the end column. A `help` that is printed has to be oxlint's; the messages without one
  for which oxlint has one are counted, in a line of `expected-oxlint.txt`, and may not become more. Not compared: the labels
  after the first, the severity, what a suggestion says, and the suggestions of a report after the first.
- oxlint does not print its fixes. `output` is the code after `--fix`, `outputWithSuggestions` after `--fix --fix-suggestions`,
  `outputDangerously` after these and `--fix-dangerously`: each is `null` if it is the same as the one before.
- `oxlint-import-project/` has the files that the cases of `import/*` are next to.

Versions that were resolved at generation time and can change what is reported:

- eslint checkout (no lockfile upstream): espree 11.2.0, eslint-scope 9.1.2, @eslint-community/regexpp 4.12.2,
  globals 16.5.0, and for the core rules' TypeScript cases @typescript-eslint/parser 8.71.1 with typescript 6.0.3.
- typescript-eslint checkout (from its lockfile): typescript 6.0.2, ts-api-utils 2.5.0, **@types/node 24.19.0** and
  **@types/react 18.3.31**. ESLint is the checkout above, not the 10.11.0 of the lockfile.

## Running them

```sh
# In a debug or a canary build of Bun
bun bd test test/cli/lint/conformance.test.ts
# The same by hand. A line for each case that fails, and the totals.
zstd -dc test/cli/lint/conformance/bundle.zst > /tmp/bundle.txt
bun bd lint --run-eslint-tests /tmp/bundle.txt --projects=/tmp/projects --extract --types --threads=8 [--suite=upstream] [--plugin=eslint] [--rule=no-undef] [--verbose] [--report=dir]
# The files, to look at them or to run them from a directory
bun test/cli/lint/conformance/sync.ts --extract "" /tmp/fixtures
bun test/cli/lint/conformance/sync.ts --extract eslint/no-undef.json /tmp/fixtures
# In the development harness (the crate `bun_lint_standalone`), which prints a line for each rule
bun-lint conformance /tmp/fixtures [--plugin=eslint] [--rule=no-undef] [--verbose] [--report=dir] [--threads=8]
```

The runner is the crate `bun_lint_conformance` (`src/lint/conformance`): it says what is compared.

Unpack the projects where no directory above them has a name that begins with a dot. Two cases of `import/no-restricted-paths` match
`**/a.js` against the absolute path, and the `**` of minimatch does not cross such a directory. The plugin itself fails them there.

`expected.txt` is what `bun lint --run-eslint-tests` prints with `--suite=upstream`: the cases that fail, and the totals.
`expected-oxlint.txt` is the same with `--suite=oxlint`. `expected-more.txt` is the same with `--suite=more --every-typed=10`: there are 22,000 cases with types in `more/`, each of
which takes a tenth of a second. Whoever changes what is printed writes the file again, in the same commit.

## Layout

- `eslint/<rule>.json`, `typescript-eslint/<rule>.json`, `react-hooks/`, `import/`, `n/`, `oxc/`: one file per rule.
- `typescript-eslint-project/`: `packages/eslint-plugin/tests/fixtures`, unchanged. The type-aware cases are linted as
  files of this project. Its tsconfigs say `"types": ["node", "react"]`.
- `node_modules/`: the declaration files of the packages that this project finds types in. 76 of the 8208 type-aware
  cases report something else without `@types/node` and `@types/react`, and one imports `@typescript-eslint/types`.
- `import-project/`, `n-project/`: the files that the cases of `import/*` and `n/*` are next to.

## Regenerating

Needs `bun`, and `node` >= 23.6 on `PATH` (or in `$NODE`): the extraction itself always runs on Node.js. The scripts
write `fixtures/`, which is not committed.

```sh
git clone --depth 1 https://github.com/eslint/eslint
git clone --depth 1 https://github.com/typescript-eslint/typescript-eslint
export ESLINT_DIR=$PWD/eslint TYPESCRIPT_ESLINT_DIR=$PWD/typescript-eslint

bun prepare-checkouts.ts             # install, build typescript-eslint, link it to $ESLINT_DIR (10 s)
bun extract-eslint.ts                # fixtures/eslint (10 s on 64 cores)
bun extract-typescript-eslint.ts     # fixtures/typescript-eslint, fixtures/typescript-eslint-project (1 min)
node extract-plugins.ts              # the other directories: its first lines say which checkouts it needs
bun summarize.ts --summary report.md # fixtures/index.json, and a report to read
bun sync.ts                          # bundle.zst, version.json, licenses/
bun extract-oxlint.ts --oxc <oxc at the tag of the executable> --oxlint <oxlint> --out <directory> <plugin>/<rule>..
bun sync.ts --oxlint <directory>     # `oxlint/` of bundle.zst
```

What is in `more/` is recorded by `extra-cases.ts`, which takes cases as JSON (a fixture is one way to write them), and
for `more/oxlint-tsgolint` the cases are read from the sources by `extract-oxc.ts` and `extract-tsgolint.ts`. To add cases
to `more/reviews`, or to record it with other versions:

```sh
bun sync.ts --extract more/reviews/ /tmp/more              # /tmp/more/more/reviews/<plugin>/<rule>.json
node extra-cases.ts ..                                     # its first lines say how: writes <directory>/<plugin>/<rule>.json
bun sync.ts --more reviews <directory>
```

The extractors take rule names to redo only those, `--jobs N`, `--out <dir>` and `--report <dir>`. After bumping
upstream, read the "Disagreements" section of the report and update the table above.

## How it works

1. Each upstream test file is loaded with its `RuleTester` replaced by a stub whose `run()` records the constructor
   config, the default config and the cases. Programmatically built cases, several `run()` calls per file and several
   files per rule (`naming-convention/`, `prefer-optional-chain/`, ...) all end up in the rule's one JSON: all valid
   cases in upstream order, then all invalid ones.
2. Each case is linted by the real `Linter` with a config layered the way the real RuleTester layers it, with only the
   rule under test enabled.
3. `messages` and `output` are what the `Linter` and `SourceCodeFixer` produced, not what the test asserts (which is
   often only a part of it). Everything the test does assert (count, `message`, `messageId`, `data`, location,
   suggestions, `output`) is compared with it, and mismatches are reported by `summarize.ts`.

## Format

```jsonc
{
  "plugin": "eslint", // or "typescript-eslint"
  "rule": "no-debugger",
  "meta": {
    "type": "problem",
    "fixable": null, // "code" | "whitespace"
    "hasSuggestions": false,
    "deprecated": false,
    "recommended": true, // meta.docs.recommended as is
    "requiresTypeChecking": false,
    "extendsBaseRule": null, // meta.docs.extendsBaseRule as is
    "messages": { "unexpected": "Unexpected 'debugger' statement." },
    "schema": [],
    "defaultOptions": null,
  },
  "cases": [
    {
      "valid": false, // which upstream list it is from
      "name": null,
      "code": "if (foo) debugger",
      "filename": "file.js",
      "options": [],
      "languageOptions": {
        "parser": "espree", // "typescript" | "other"
        "ecmaVersion": "latest",
        "sourceType": "module",
        "globals": null,
        "parserOptions": null,
      },
      "settings": null,
      "typeAware": false,
      "tsconfig": null,
      "skip": null,
      "messages": [
        {
          "messageId": "unexpected",
          "message": "Unexpected 'debugger' statement.",
          "line": 1,
          "column": 10,
          "endLine": 1,
          "endColumn": 18,
          "fix": null, // { "range": [0, 9], "text": "" }
          "suggestions": [], // { messageId, desc, fix, output }
        },
      ],
      "output": null,
    },
  ],
}
```

The files are plain JSON, ASCII only (everything else is `\uXXXX`), 1-space indent, with anything that fits in 120
columns on one line.

- **`filename`** is what ESLint was given. When the test names none: `file.js`/`file.jsx` (`ecmaFeatures.jsx`) for
  espree, `file.ts`/`file.tsx` for the core rules' TypeScript cases, and `file.ts`/`react.tsx` for typescript-eslint, as
  its RuleTester picks. For a type-aware case it is relative to `fixtures/typescript-eslint-project/`.
- **`languageOptions.ecmaVersion`/`sourceType`** are the effective ESLint-level values after merging all config layers:
  never `null`, and `ecmaVersion` is `"latest"` or ESLint's normalized form (`6` is `2015`; `3` and `5` stay).
- **`languageOptions.parserOptions`** is the merged, JSON-serializable `parserOptions`. A parser is given
  `{ ecmaVersion, sourceType, ...parserOptions }`, so an `ecmaVersion`/`sourceType` in here overrides, for the parser and
  its scope analysis only, the ESLint-level one. typescript-eslint's RuleTester always sets `ecmaVersion: "latest"`,
  `sourceType: "module"` and `disallowAutomaticSingleRunInference: true`; the last is never recorded, the first two only
  when they differ from the ESLint-level value. `tsconfigRootDir` is relative to the fixture project (`"."`,
  `"unstrict"`).
- **`typeAware`** is `parserOptions.project || parserOptions.projectService`. **`tsconfig`** is the config that applies,
  relative to the fixture project. The type-aware cases were linted with the fixture project as the working directory
  (upstream: `packages/eslint-plugin`), which is what `{ "from": "file", "path": ... }` specifiers in rule options are
  relative to.
- **`messages`** are in ESLint's order (line, then column). `line` is 1-based and so is `column`. `range`s are UTF-16
  code unit offsets into the code **without its BOM**; `unicode-bom` removes one with `[-1, 0]`.
- **`messages[].ruleId`** is only there when the message is not from the rule under test. Four core cases turn on a second
  core rule with an `/* eslint other-rule: 2 */` comment.
- **`output`** is one pass of `SourceCodeFixer.applyFixes()` (overlapping fixes are dropped, as with `--fix`), or `null`
  if no message has a fix. **`suggestions[].output`** is the code with only that suggestion applied.
- The RuleTesters register the rule as `rule-to-test/<rule>` and `@rule-tester/<rule>`. The fixtures were recorded with
  the real id (`<rule>`, `@typescript-eslint/<rule>`), and the handful of directive comments that spell the id were
  rewritten to match.
- `linterOptions.reportUnusedDisableDirectives` is off, as in ESLint's RuleTester. (typescript-eslint's sets it to
  `"warn"`, but none of its cases has an unused directive.)

### `skip`

A case that cannot be reproduced without upstream's test code. It still has what ESLint reported.

| `skip`                     | plugin            | cases | why                                                       |
| -------------------------- | ----------------- | ----- | --------------------------------------------------------- |
| `test-only plugin: <name>` | eslint            | 12    | the code enables a helper rule that the test file defines |
| `test-only rule: <name>`   | typescript-eslint | 5     | same, through `defineRule()`                              |
| `parser: custom`           | typescript-eslint | 1     | a stub parser without parser services                     |
| `skipped upstream`         | typescript-eslint | 1     | `skip: true` in the test; a known false negative          |

106 core cases name a "parser" of `tests/fixtures/parsers/*.js`, which returns a hard-coded AST (type annotations, old
babel-eslint and typescript-eslint). They are not skipped: 105 are recorded with the real parser that reads the code
(`@typescript-eslint/parser` as `file.ts`, else espree), with which ESLint reports exactly what it reports for the
hard-coded AST and what the test asserts. `no-var`'s `declare var foo = 2;`, which typescript-estree throws on, is a case
for the parser `"other"`. **`upstreamParser`** names the file. A case for which a real parser gives another result would be
skipped as `parser: <file> (the tree of a real parser gives another result)`.

The extractors would also flag `fatal: <message>` (a parse error), `processor`, `before/after hook`,
`dependencyConstraints not satisfied` and `not JSON-serializable: <path>`; nothing upstream needs them today.

### Left out

Three generated stress tests with more than 50,000 characters of code (`no-multi-spaces`, `no-multiple-empty-lines`,
`prefer-template`: a string of 1,000,000 backslashes). Otherwise the case counts equal the number of tests the real
RuleTesters register.

`packages/eslint-plugin/tests/eslint-rules/` (seven core rules run with the TypeScript parser) is not extracted.

### Known disagreements with upstream's assertions

- `typescript-eslint/max-params#22`: upstream is tested with ESLint 10.11.0; 10.12.0 taught `getFunctionHeadLoc` about
  `TSFunctionType`, which moves the report.
- `typescript-eslint/strict-boolean-expressions#184`: the `skipped upstream` case.
