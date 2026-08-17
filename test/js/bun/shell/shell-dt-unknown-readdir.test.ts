// The shell's `ls -R` and `cp -R` builtins decide what to recurse into from the
// kind readdir reports for each entry. On filesystems whose readdir reports
// every entry as DT_UNKNOWN (FUSE, some NFS servers, XFS with ftype=0) they have
// to lstat the entries instead: `ls -R` used to list only the top level and
// `cp -R` used to fail with ENOTSUP when it tried to copy a subdirectory as a
// file. Each test runs a fixture under `dtUnknownReaddir` (harness), which
// simulates such a filesystem with an LD_PRELOAD shim.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunExe, dtUnknownReaddir, tempDir } from "harness";

let shimEnv: NodeJS.Dict<string>;

beforeAll(async () => {
  if (dtUnknownReaddir.available) shimEnv = await dtUnknownReaddir.env();
}, 30_000);

const TREE = {
  "src/a.txt": "a",
  "src/sub/b.txt": "b",
};

const LS_FIXTURE = /* js */ `
import { $ } from "bun";
const { stdout, stderr, exitCode } = await $\`ls -R src\`.quiet().nothrow();
console.log(JSON.stringify({ lines: stdout.toString().split("\\n").filter(Boolean).sort(), stderr: stderr.toString(), exitCode }));
`;

const CP_FIXTURE = /* js */ `
import { $ } from "bun";
import { readdirSync } from "node:fs";
const { stderr, exitCode } = await $\`cp -R src dest\`.quiet().nothrow();
let copied = [];
try { copied = readdirSync("dest", { recursive: true }).sort(); } catch {}
console.log(JSON.stringify({ copied, stderr: stderr.toString(), exitCode }));
`;

async function runFixture(dir: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    cwd: dir,
    env: { ...shimEnv, ...extraEnv },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: unknown = stdout;
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, stderr, exitCode };
}

describe.skipIf(!dtUnknownReaddir.available)("shell builtins on a filesystem whose readdir reports DT_UNKNOWN", () => {
  test.concurrent("ls -R recurses into subdirectories", async () => {
    using dir = tempDir("shell-ls-dt-unknown", { ...TREE, "fixture.mjs": LS_FIXTURE });

    expect(await runFixture(String(dir))).toEqual({
      result: { lines: ["a.txt", "b.txt", "src/sub:", "sub"], stderr: "", exitCode: 0 },
      stderr: `${dtUnknownReaddir.marker}\n`,
      exitCode: 0,
    });
  });

  test.concurrent("cp -R copies subdirectories", async () => {
    using dir = tempDir("shell-cp-dt-unknown", { ...TREE, "fixture.mjs": CP_FIXTURE });

    // The cp builtin is only enabled on POSIX behind this flag; without it the
    // shell would spawn the system cp.
    expect(await runFixture(String(dir), { BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" })).toEqual({
      result: { copied: ["a.txt", "sub", "sub/b.txt"], stderr: "", exitCode: 0 },
      stderr: `${dtUnknownReaddir.marker}\n`,
      exitCode: 0,
    });
  });
});
