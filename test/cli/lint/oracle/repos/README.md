# Open-source repositories through their own tools and through `bun lint` / `bun format`

`bun lint` is meant to replace ESLint and oxlint, and `bun format` to replace Prettier and oxfmt, without a change to a
project. This directory checks that on real projects: it takes popular repositories as they are (their configuration files,
plugins, ignore files, and the commands of their `package.json` and workflows), runs their tool and ours with the same
arguments, and compares the results one by one.

It is not part of CI: it needs the network, root, and tens of gigabytes.

| File            | What                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `manifest.json` | The repositories: commit, package manager, their lint and format commands, notes                 |
| `run.ts`        | Clones at the commit, installs, runs both, compares, prints the tables                           |
| `compare.ts`    | The comparisons: messages of ESLint and oxlint as multisets for each file, written trees by byte |
| `sandbox.ts`    | What every command that reads a clone runs in                                                    |

## Run it

```sh
# All repositories, four at a time, on sixteen processors.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --jobs=4 --cpus=0-15

# One repository, some stages.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --only=vuejs/core --stages=clone,install,lint

# Wall time, CPU time, instructions and peak memory: the best of three, in turns. Alone on the machine.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --stages=time

# Give the disk back: everything in the clones that git does not track.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --stages=clean

# The tables again, from the results in <work>/.results.
bun run.ts --work=/data/repos --table

# A command in a copy of a clone, in the sandbox: to look into a difference.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --exec=vuejs/core -- '$BUN lint packages/shared -f json | head'

# What an entry of the manifest needs: commit, lock files, configuration files, scripts, versions in the lock file.
sudo bun run.ts --bun=/path/to/bun --work=/data/repos --discover=owner/repo
```

Stages: `clone`, `install`, `lint`, `fix`, `format` (the default), `time`, `clean`. `--seconds` (900) and `--memory-kb`
(16,000,000) limit each command. `--keep` keeps the output of the runs in `<work>/.runs`. `--manifest=<path>` reads another
manifest.

Each result is a file in `<work>/.results`, with the revision of `bun`, the versions of their tools, the exit codes, what both
printed on stderr, the counts, and for each kind of difference (a rule and who reported it, a file extension) a few examples.

## What is compared

- **`lint`**: their command and `bun lint` with the same arguments and `-f json`. For each file the multiset of rule, severity,
  line, column, end line, end column and message, suppressed messages included; for the messages that are the same, the fix and
  the suggestions; which files were linted; the exit code. With oxlint: the rule, the severity and where a diagnostic starts,
  since the texts of `bun lint` are ESLint's, and the number of files.
- **`fix`**: both with `--fix`, each on a copy. The files that were changed, byte for byte.
- **`format`**: `--list-different`, then both write, each on a copy: the files that were changed, byte for byte. Which files
  each reads: Prettier prints them; for `bun format`, empty lines are appended to every tracked file of a copy, which makes
  `--list-different` name each file that it reads.
- **The judge** is their installed version for ESLint; where the results differ, ESLint 10.12.0, which `bun lint` follows,
  runs too, with their configuration and plugins, to tell what ESLint has changed since from what we get wrong. For Prettier it is 3.9.9, which `bun format` follows, next to their
  version: a repository on Prettier 2 differs for reasons that are in Prettier's changelog. For oxlint and oxfmt it is the
  version in their lock file, next to oxlint 1.80.0 and oxfmt 0.72.0.
- In a package that has a `lint` or a `format` script, `bun lint` runs that script, except in the script itself. So
  `npm_lifecycle_event` is set, as it is in `"lint": "bun lint"`.

## The sandbox

An `eslint.config.js`, a plugin, a `.pnpmfile.cjs`, the `yarnPath` of a `.yarnrc.yml` are programs, written by whoever
contributes to any of these repositories or to a package they depend on. Installation scripts are off
(`--ignore-scripts`), but to lint is to run such programs. So every command that reads a clone (git, the package managers, their
tools, and `bun lint` and `bun format`, which evaluate the same files) runs:

- in namespaces of its own for mounts and processes, and without a network except to clone and to install;
- in a new root directory that has `/usr`, `/etc`, `/dev`, `/sys` and `/proc`, an empty `/tmp`, and nothing else but the clone,
  the directory of `bun`, and the judges. No home directory, no credentials, no other clone;
- as `nobody`, without capabilities, with `no_new_privs`, with an environment of five variables;
- with an overlay over the clone: what a tool writes goes to a directory of the run, and the clone stays as it is. That
  directory is "the copy" above, and holds exactly the files that were written;
- with limits: a control group for memory (`systemd-run --scope -p MemoryMax=.. -p MemorySwapMax=0`), `timeout`, `taskset`,
  `nice`, no core dumps. The limit is not `ulimit -v`: each thread of Node.js reserves gigabytes of addresses that it never
  uses, so pnpm, yarn and `eslint --concurrency` die under a limit on addresses.

`run.ts` itself only reads what the runs leave behind, as data. It deletes nothing outside `<work>/.runs`; `clean` is
`git clean` in the sandbox, where only that clone can be written to.

It needs Linux, root, util-linux (`unshare`, `setpriv`, `pivot_root`), systemd, GNU `time`, `perf`, `git` and `node`.

## Add a repository

1. `--discover=owner/repo`.
2. Read their `package.json` and workflows for the commands that their CI runs. Take the arguments as they are, without what
   chooses a format (`-f`), writes (`--fix`, `--write`, `--check`) or keeps a cache (`--cache`). `"shell": true` where their script
   leaves a pattern to the shell.
3. `install`: `bun` where it can read their lock file, else their package manager. `none` with `pinned` versions for oxlint and oxfmt
   where the configuration has no plugins in JavaScript and does not ask for types: these two need nothing else.
4. `prepare` only if a configuration file cannot be loaded without generated files, and then the one command, with the reason in
   `notes`.

Nothing of a repository is copied into this one: a difference becomes a small program of our own that shows it, in the tests of
the linter or the formatter.
