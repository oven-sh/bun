// The command lines of Prettier's own integration tests (`runCli("cli/..", [..])` in `tests/integration/__tests__/*.js` of
// prettier/prettier, MIT: see LICENSE), with what Prettier 3.9 does in each: the exit code, the files afterwards, the files that
// `--check` and `--list-different` name, and what is printed for standard input. `bun format` writes unless told otherwise, so
// Prettier was given `--write` where the command line only prints.
// `cases.json` is written by `test/cli/lint/oracle/driver/prettier-fixtures.mjs --record`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cases, fixtures } from "./cases.json";

type Files = Record<string, string | { link: string }>;
const command = [bunExe(), "format"];
// The languages that `bun format` leaves alone.
const notCompared = /\.(mdx|html?|vue)$/;
const env = { ...bunEnv, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined };

describe.concurrent("bun format does what Prettier does", () => {
  for (const it of cases) {
    const top = it.directory.split("/").slice(0, 2).join("/");
    const files = (fixtures as Record<string, Files>)[top];
    const links = Object.entries(files).filter(([, file]) => typeof file !== "string") as [string, { link: string }][];
    // A name that Windows does not allow.
    const isForPosix = links.length > 0 || Object.keys(files).some(name => /[<>:"|?*\\]/.test(name));
    test.skipIf(isWindows && isForPosix)(`${it.test}: ${it.directory} $ ${it.args.join(" ")}`, async () => {
      const texts = Object.entries(files).filter(([, file]) => typeof file === "string") as [string, string][];
      using dir = tempDir("prettier-cli", Object.fromEntries(texts.map(([name, text]) => [`${top}/${name}`, text])));
      for (const [name, { link }] of links) symlinkSync(link, join(String(dir), top, name));
      await using proc = Bun.spawn({
        cmd: [...command, ...it.args],
        env,
        cwd: join(String(dir), it.directory),
        stdin: Buffer.from(it.input ?? ""),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const changed = texts.flatMap(([name, text]) => {
        const after = readFileSync(join(String(dir), top, name), "utf8");
        return after === text || notCompared.test(name) ? [] : [[`${top}/${name}`, after]];
      });
      const named = (stdout + stderr).split("\n").map(line => (line.startsWith("[warn] ") ? line.slice(7) : line));
      expect({
        changed: Object.fromEntries(changed),
        listed: it.listed && it.listed.filter(name => named.includes(name)),
        stdout: it.stdout === undefined ? undefined : stdout,
        exitCode,
      }).toEqual({
        changed: it.changed,
        listed: it.listed,
        stdout: it.stdout,
        exitCode: it.exitCode,
      });
    });
  }
});
