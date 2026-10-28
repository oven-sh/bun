# Real applications under `--aot`

Open-source TypeScript projects that nobody here wrote, each at a pinned commit, with their own test suites. They answer two questions: is `--aot` correct on such code, and what does a project have to change before it can use it?

`projects.json` is the list: repository, commit, the directory of the package, its `tsconfig.json`, an entry point and a kind.

```sh
bun test/aot/real-apps/run.ts <work folder> [--only <regex>] [--steps fetch,types,build,tests,compiled] [--jobs <n>] [--files-at-a-time <n>] [--bun <path>] [--tsc <path>] [--results <name>] [--no-jail]
```

| Step       | What runs                                                                                     | Network | Runs the project's code |
| ---------- | --------------------------------------------------------------------------------------------- | ------- | ----------------------- |
| `fetch`    | `git fetch --depth 1` of the commit, `bun install --ignore-scripts`                           | yes     | no                      |
| `types`    | TypeScript 7 (`--tsc`) and `bun check` on the same `tsconfig.json`; every difference is a bug | no      | no                      |
| `build`    | `bun build --compile` and `bun build --compile --aot --no-macros` of the entry point          | no      | no                      |
| `tests`    | `bun test` twice, then `bun test --aot`, compared test by test                                | no      | yes                     |
| `compiled` | `bun test` twice, then each test file alone as compiled code, compared test by test           | no      | yes                     |

`bun test --aot` checks a project as the build does and then runs it from its source files. Only `compiled` runs machine code: each file in which plain Bun passes a test is compiled with all it imports and run by `bun test --debug-aot`, alone, so that a file that isn't built or ends early takes no other file with it. Type errors stop a build, and many projects check their tests under looser rules than their sources. So a file that isn't built for type errors is tried again with `// @ts-nocheck` on the files that the errors name, which the jail throws away afterwards. It isn't among the default steps. Put `<work folder>/scratch` on a file system in memory: the jail's overlay writes there, and the kernel syncs that file system each time a jail ends.

It prints one line per project and writes `<work folder>/results.json`. A test counts only if plain Bun passes it twice. A failure under `--aot` is grouped by its message and by the innermost stack frame inside the project.

`bun check` and `bun build` are called from an empty directory with absolute paths: in a project whose `package.json` has a script named `check`, `bun check` runs that script, and a `bunfig.toml` can name a preload.

On Linux every step except `fetch` runs in `jail.sh`: its own user, mount, process and network namespaces, loopback only, an empty home directory, and the project as an overlay whose writes are thrown away. Run third-party code nowhere else. `--no-jail` is for your own projects.

`programs/` holds small programs in the shape of code that these projects contain, which TypeScript accepts and plain Bun runs, and in which a value does not fit the type it is declared with. `programs.test.ts` runs each one plain, under `bun run --aot` and as an executable: all three print the same.

`test-runs.test.ts` holds small projects in the shape of these repositories where what `bun test --aot` does with a test file depends on the other test files of the run. Each test states a property that does not hold yet, as `test.failing`.

`untyped-company.test.ts` holds one small program in the shape of Elysia, built four times: alone, with one more typed module, with that module under `// @ts-nocheck`, and with it as a `.js` file. The executable should do the same in all four. It does not yet: the untyped module takes a type check off a typed handler in another module, so those two are `test.failing`.

`class-reexported-as-a-type.test.ts` holds one small program in the shape of h3, twice: a package re-exports an interface, or a class, only as a type, and the program lists the exports of a module that passes it on. With the class the executable throws while it makes that list, so that one is `test.failing`.

`real-apps.test.ts` runs all steps for every project when `AOT_REAL_APPS` names a work folder (`AOT_REAL_APPS_ONLY` is a regular expression of names). It fails on a difference from TypeScript, on a build that `--aot` refuses for a reason other than a type error, and on a death by signal. It takes hours and about 40 GB, so it is skipped otherwise.
