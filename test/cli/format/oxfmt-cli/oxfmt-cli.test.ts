// The cases of oxfmt's own command line tests (`apps/oxfmt/test/cli/*/options.json` of oxc-project/oxc, MIT: see LICENSE), with what
// oxfmt 0.72 does in each: the exit code, the files afterwards, and the files that `--check` and `--list-different` name.
// `cases.json` is written by `test/cli/lint/oracle/driver/oxfmt-fixtures.mjs --record`.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";
import { cases, fixtures } from "./cases.json";

afterAll(endChildren);

type Files = Record<string, string | { link: string }>;
// A fixture has `experimentalTailwindcss`, which has no effect here. That `bun format` says so is tested elsewhere.
const command = [bunExe(), "format", "--allow-unsupported"];
const env = { NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined };

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
      await using proc = spawn({
        cmd: [...command, ...it.args],
        env: { ...bunEnv, ...(it as { env?: Record<string, string> }).env, ...env },
        cwd: join(root, it.cwd ?? "."),
        stdin: it.stdin === undefined ? "ignore" : Buffer.from(files[it.stdin] as string),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Also what `--init` makes.
      const made = Object.keys(it.changed).filter(name => !(name in files) && existsSync(join(root, name)));
      const changed = [...texts, ...made.map(name => [name, undefined])].flatMap(([name, text]) => {
        const after = readFileSync(join(root, name as string), "utf8");
        return after === text ? [] : [[name, after]];
      });
      const named = (stdout + stderr)
        .replace(/\x1b\[[0-9;]*m/g, "")
        .split("\n")
        .map(line => line.replace(/^\[warn\] | \(\d+ms\)$/g, ""));
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
