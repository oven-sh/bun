import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, bunEnv as env, isMusl, isWindows, runBunInstall, tempDir } from "harness";
import { join } from "path";

// `#!/usr/bin/env -S node` broke `bun install` bin linking on Windows: the
// shebang parser treated "-S" as the interpreter, so the shim failed with
// "interpreter executable '-S' not found in %PATH%". Affects any package using
// `env -S` (e.g. @google/gemini-cli).
//
// On POSIX, `bun install` creates a symlink and the OS handles the shebang via
// /usr/bin/env directly — BinLinkingShim.zig is never invoked. The Windows-only
// describe block below is the only part of this file that directly exercises
// the fix.

// --- npm cmd-shim reference ----------------------------------------------------
// npm's cmd-shim is the canonical "parse shebangs on Windows" implementation.
// We inline its exact regex so we can prove parity on the cases that matter and
// document where we intentionally go further.
//
// Source: https://github.com/npm/cmd-shim/blob/main/lib/index.js (cmd-shim@7.0.0)
const npmShebangRegex = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?((?:[^ \t=]+=[^ \t=]+\s+)*))?([^ \t]+)(.*)$/;

function npmParse(shebang: string): { prog: string; args: string } | null {
  const m = shebang.match(npmShebangRegex);
  if (!m) return null;
  return { prog: m[2], args: (m[3] || "").trim() };
}

type Case = {
  shebang: string;
  bun: { launcher: string; is_node_or_bun: boolean; is_node: boolean };
  // null = npm's regex gets this wrong; `npmWrong` documents the specific wrong
  // answer so the reference tests fail loudly if npm ever fixes their regex.
  npm: { prog: string; args: string } | null;
  npmWrong?: string;
};

const cases: Case[] = [
  {
    shebang: "#!/usr/bin/env node",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "" },
  },
  {
    shebang: "#!/usr/bin/env -S node",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "" },
  },
  {
    // Covers the /bin/env alternate prefix branch in BinLinkingShim.parse().
    // npm's regex only matches /usr/bin/env, so it sees /bin/env as the program.
    shebang: "#!/bin/env -S node",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    npm: null,
    npmWrong: "/bin/env",
  },
  {
    shebang: "#!/usr/bin/env -S node --no-warnings",
    bun: { launcher: "node --no-warnings", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "--no-warnings" },
  },
  {
    shebang: "#!/usr/bin/env -S bun",
    bun: { launcher: "bun", is_node_or_bun: true, is_node: false },
    npm: { prog: "bun", args: "" },
  },
  {
    shebang: "#!/usr/bin/env FOO=bar node",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "" },
  },
  {
    shebang: "#!/usr/bin/env -S FOO=bar node --flag",
    bun: { launcher: "node --flag", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "--flag" },
  },
  {
    // npm's regex only special-cases `-S`, so it captures `-u` as the program.
    // Bun knows `-u` takes a value, consumes `FOO`, and finds `node`. Synthetic
    // case — no real npm package does this.
    shebang: "#!/usr/bin/env -S -u FOO node",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    npm: null,
    npmWrong: "-u",
  },
  {
    // Tab-delimited shebangs: some editors/generators use tabs instead of spaces.
    shebang: "#!/usr/bin/env\t-S\tnode",
    bun: { launcher: "node", is_node_or_bun: true, is_node: true },
    // npm's regex uses \s+ which matches tabs too.
    npm: { prog: "node", args: "" },
  },
  {
    // Mixed tabs and spaces in shebang. The launcher preserves the original
    // whitespace between program and args (a tab here), which is fine — both
    // spaces and tabs are whitespace in Windows command lines.
    shebang: "#!/usr/bin/env\t-S node\t--no-warnings",
    bun: { launcher: "node\t--no-warnings", is_node_or_bun: true, is_node: true },
    npm: { prog: "node", args: "--no-warnings" },
  },
];

// Pins our understanding of npm's regex. Runs everywhere; doesn't test Bun.
describe("npm cmd-shim regex reference", () => {
  for (const c of cases) {
    test(JSON.stringify(c.shebang), () => {
      if (c.npm) {
        expect(npmParse(c.shebang)).toEqual(c.npm);
      } else {
        expect(npmParse(c.shebang)?.prog).toBe(c.npmWrong);
      }
    });
  }
});

// --- Bun's Windows .bunx parser ------------------------------------------------
// Read the .bunx metadata file and decode it.
//
// Layout (BinLinkingShim.zig):
//   [bin_path: utf16le] ['"': u16] ['\0': u16]
//   if shebang:
//     [launcher: utf16le] [' ': u16] [bin_path_byte_len: u32le] [arg_byte_len: u32le]
//   [Flags: u16le]   bits: is_node_or_bun, is_node, has_shebang, version_tag(13)

const QUOTE_NUL = Buffer.from([0x22, 0x00, 0x00, 0x00]); // '"' '\0' in utf16le
const TRAILER = 2 + 4 + 4 + 2; // [' '][u32][u32][Flags] after launcher

function decodeBunx(bytes: Buffer) {
  const flags = bytes.readUInt16LE(bytes.length - 2);
  const has_shebang = (flags & 0b100) !== 0;
  let launcher: string | null = null;
  if (has_shebang) {
    const mark = bytes.indexOf(QUOTE_NUL);
    expect(mark).toBeGreaterThanOrEqual(0);
    launcher = bytes.subarray(mark + QUOTE_NUL.length, bytes.length - TRAILER).toString("utf16le");
  }
  return {
    is_node_or_bun: (flags & 0b001) !== 0,
    is_node: (flags & 0b010) !== 0,
    has_shebang,
    launcher,
  };
}

describe.concurrent.if(isWindows)("bun windows .bunx shebang parser", () => {
  for (const [i, c] of cases.entries()) {
    test(JSON.stringify(c.shebang), async () => {
      using dir = tempDir("issue-28126-bunx", {
        "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", bin: { [`bin${i}`]: "index.js" } }),
        "pkg/index.js": `${c.shebang}\nconsole.log(1);\n`,
        "consumer/package.json": JSON.stringify({
          name: "consumer",
          version: "1.0.0",
          dependencies: { pkg: "file:../pkg" },
        }),
      });
      const consumerDir = join(String(dir), "consumer");
      await runBunInstall(env, consumerDir);

      const got = decodeBunx(readFileSync(join(consumerDir, "node_modules", ".bin", `bin${i}.bunx`)));

      expect(got).toEqual({
        has_shebang: true,
        is_node_or_bun: c.bun.is_node_or_bun,
        is_node: c.bun.is_node,
        launcher: c.bun.launcher,
      });

      // Where npm agrees: the program npm extracts is the first word of our launcher.
      if (c.npm) {
        expect(got.launcher?.split(/\s+/)[0]).toBe(c.npm.prog);
      }
    });
  }
});

// --- End-to-end integration ----------------------------------------------------
// On Windows this exercises the shim; on POSIX it exercises the OS /usr/bin/env.
// BusyBox env (Alpine/musl) doesn't support -S.
describe.concurrent.skipIf(isMusl)("env -S shebang integration", () => {
  for (const { shebang, binName } of [
    { shebang: "#!/usr/bin/env -S node", binName: "env-s-node" },
    { shebang: "#!/usr/bin/env -S node --no-warnings", binName: "env-s-args" },
    { shebang: "#!/usr/bin/env -S bun", binName: "env-s-bun" },
  ]) {
    test(`runs bin with ${JSON.stringify(shebang)}`, async () => {
      using dir = tempDir("issue-28126-run", {
        "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", bin: { [binName]: "index.js" } }),
        "pkg/index.js": `${shebang}\nconsole.log("ok:" + ${JSON.stringify(binName)});\n`,
        "consumer/package.json": JSON.stringify({
          name: "consumer",
          version: "1.0.0",
          dependencies: { pkg: "file:../pkg" },
        }),
      });
      const consumerDir = join(String(dir), "consumer");
      await runBunInstall(env, consumerDir);

      await using proc = spawn({
        cmd: [bunExe(), "run", binName],
        cwd: consumerDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("interpreter executable");
      expect(stderr).not.toContain("not found in %PATH%");
      expect(stdout).toContain(`ok:${binName}`);
      expect(exitCode).toBe(0);
    });
  }
});
