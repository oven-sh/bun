// The cases of oxfmt's own command line tests (`apps/oxfmt/test/cli/*/options.json` of oxc-project/oxc, MIT: see LICENSE), with what
// oxfmt 0.72 does in each: the exit code, the files afterwards, and the files that `--check` and `--list-different` name.
// `cases.json` is written by `test/cli/lint/oracle/driver/oxfmt-fixtures.mjs --record`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cases, fixtures } from "./cases.json";

type Files = Record<string, string | { link: string }>;
const command = [bunExe(), "format"];
const env = { ...bunEnv, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined };

describe.concurrent("bun format does what oxfmt does", () => {
  for (const it of cases) {
    const files = { ...(fixtures as Record<string, Files>)[it.name], ...it.gitignore } as Files;
    const links = Object.entries(files).filter(([, file]) => typeof file !== "string") as [string, { link: string }][];
    test.skipIf(isWindows && links.length > 0)(`${it.name}/${it.index}: ${it.args.join(" ")}`, async () => {
      const texts = Object.entries(files).filter(([, file]) => typeof file === "string") as [string, string][];
      // Without a configuration file `bun format` is like Prettier. An empty one above the fixtures makes it like oxfmt.
      using dir = tempDir("oxfmt-cli", {
        ".oxfmtrc.json": "{}\n",
        ...Object.fromEntries(texts.map(([name, text]) => [`fixtures/${name}`, text])),
      });
      const root = join(String(dir), "fixtures");
      for (const [name, { link }] of links) symlinkSync(link, join(root, name));
      await using proc = Bun.spawn({
        cmd: [...command, ...it.args],
        env,
        cwd: join(root, it.cwd ?? "."),
        stdin: it.stdin === undefined ? "ignore" : Buffer.from(files[it.stdin] as string),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const changed = texts.flatMap(([name, text]) => {
        const after = readFileSync(join(root, name), "utf8");
        return after === text ? [] : [[name, after]];
      });
      const named = (stdout + stderr)
        .split("\n")
        .flatMap(line => (line.startsWith("[warn] ") ? [line.slice(7)] : [line]));
      expect({
        changed: Object.fromEntries(changed),
        listed: it.listed && it.listed.filter(name => named.includes(name)),
        others:
          it.listed && texts.map(([name]) => name).filter(name => named.includes(name) && !it.listed.includes(name)),
        stdout: it.stdout === undefined ? undefined : stdout,
        exitCode,
      }).toEqual({
        changed: it.changed,
        listed: it.listed,
        others: it.listed && [],
        stdout: it.stdout,
        exitCode: it.exitCode,
      });
    });
  }
});
