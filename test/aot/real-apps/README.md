# Real applications under `--aot`

Open-source TypeScript projects, each at a pinned commit, with their own test suites. They answer two questions. Is `--aot` correct on such code? What does a project have to change before it can use it?

| Path | What it is |
| --- | --- |
| `projects.json` | the list of projects |
| `run.ts` | fetches, checks, builds and tests them |
| `jail.sh` | the sandbox that their code runs in |
| `test-runs.test.ts` | small projects in the shape of these repositories, which CI runs |

## Run

```sh
bun test/aot/real-apps/run.ts <work folder> [--only <regex>] [--steps fetch,types,build,tests,compiled,together] [--jobs <n>] [--bun <path>] [--tsc <path>] [--no-jail]
```

| Step | What runs | Network | Runs the project's code |
| --- | --- | --- | --- |
| `fetch` | `git fetch --depth 1` of the commit, `bun install --ignore-scripts` | yes | no |
| `types` | TypeScript (`--tsc`) and `bun check` on the same `tsconfig.json`. Every difference is a bug | no | no |
| `build` | `bun build --compile` and `bun build --compile --aot --no-macros` of the entry point | no | no |
| `tests` | `bun test` twice, then `bun test --aot`, compared test by test | no | yes |
| `compiled` | `bun test` twice, then each test file alone as compiled code, compared test by test | no | yes |
| `together` | `bun test --isolate` twice, then the whole suite as one compiled program under `--isolate` | no | yes |

It prints one line per project and writes `<work folder>/results.json`. A test counts only if plain Bun passes it twice.

On Linux every step except `fetch` runs in `jail.sh`: its own user, mount, process and network namespaces, loopback only, an empty home directory, and the project as an overlay whose writes are thrown away. Run third-party code nowhere else. `--no-jail` is for your own projects.

## Add a project

Add an entry to `projects.json`: `name`, `repository`, `commit`, `directory` (of the package), `tsconfig`, `entryPoint` and `kind` (`application`, `cli`, `framework` or `library`).
