import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { bun, lintEnv, markerExists, markerSource } from "./lint-helpers";

describe("a file that writes a marker when it is run", () => {
  test.concurrent.each(["--lint file.ts", "run --lint file.ts"])("is not run by `bun %s`", async command => {
    using dir = tempDir("lint-marker", { "file.ts": markerSource });
    const cwd = String(dir);
    expect(await bun(cwd, command.split(" "))).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await markerExists(cwd)).toBe(false);
  });
});

describe("--lint among the flags that bunx reads before the package name", () => {
  const refused = { stdout: "", stderr: "error: --lint cannot be used with bunx\n", exitCode: 1 };
  // The refusal does not depend on the variable that turns `--lint` on.
  const withoutVariable: NodeJS.Dict<string> = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: undefined };

  /** Runs Bun under the name `bunx`, which makes it bunx, and returns what `bun` returns. */
  async function bunx(cwd: string, args: string[], env: NodeJS.Dict<string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      argv0: "bunx",
      env,
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent.each([
    "bunx --lint lint-marker",
    "bun x --lint lint-marker",
    "bun --lint x lint-marker",
    "bun x --lint=value lint-marker",
    "bun x --package lint-marker --lint lint-marker",
  ])("`%s` is refused and the package is not run", async command => {
    // bunx finds this package in node_modules/.bin and installs nothing. Run, it writes the marker and prints its arguments.
    using dir = tempDir("lint-bunx", {
      [isWindows ? "node_modules/.bin/lint-marker.cmd" : "node_modules/.bin/lint-marker"]: isWindows
        ? "@echo off\r\necho ran> marker.txt\r\necho %*\r\n"
        : '#!/bin/sh\necho ran > marker.txt\necho "$@"\n',
    });
    const cwd = String(dir);
    if (!isWindows) chmodSync(join(cwd, "node_modules/.bin/lint-marker"), 0o755);

    const [name, ...args] = command.split(" ");
    const run = name === "bunx" ? bunx : bun;
    const [set, unset] = await Promise.all([run(cwd, args, lintEnv), run(cwd, args, withoutVariable)]);
    expect(set).toEqual(refused);
    expect(unset).toEqual(refused);
    expect(await markerExists(cwd)).toBe(false);

    // After the name of the package the flag is an argument of the package, and bunx runs the package.
    const after = await bun(cwd, ["x", "lint-marker", "--lint"]);
    expect(after.stdout.trim()).toBe("--lint");
    expect(after.exitCode).toBe(0);
    expect(await markerExists(cwd)).toBe(true);
  });
});

// Every place stderr reports, as `file:line:column`. A code frame has `at bad.ts:1:9`, a plain line starts `bad.ts(1,9)`.
function positions(stderr: string) {
  const found = new Set<string>();
  for (const [, file, line, column] of stderr.matchAll(/^(?: +at )?([\w.-]+)[(:](\d+)[,:](\d+)/gm)) {
    found.add(`${file}:${line}:${column}`);
  }
  return [...found].sort();
}

const unsupportedExtension = (file: string) =>
  `File '${file}' has an unsupported extension. The only supported extensions are ` +
  "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'.";

describe("bun --lint operands", () => {
  test.concurrent("a file without an error is parsed and not run", async () => {
    // Run, this file prints a line.
    using dir = tempDir("lint-clean", { "clean.ts": 'console.log("executed");\nexport const answer: number = 42;\n' });
    expect(await bun(String(dir), ["--lint", "clean.ts"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test.concurrent("a syntax error is printed to stderr and the exit code is 2", async () => {
    using dir = tempDir("lint-syntax-error", { "bad.ts": "let x = ;\n" });
    const { stdout, stderr, exitCode } = await bun(String(dir), ["--lint", "bad.ts"]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unexpected ;");
    expect(positions(stderr)).toEqual(["bad.ts:1:9"]);
    expect(exitCode).toBe(2);
  });

  test.concurrent("the files after one with an error are still checked", async () => {
    using dir = tempDir("lint-continue", {
      "first.ts": "let x = ;\n",
      "second.ts": "\nlet y = ;\n",
      "third.js": "let z = 1;\n",
      "fourth.js": "\n\nlet w = ;\n",
    });
    const operands = ["first.ts", "second.ts", "third.js", "fourth.js"];
    const { stdout, stderr, exitCode } = await bun(String(dir), ["--lint", ...operands]);
    expect(stdout).toBe("");
    expect(positions(stderr)).toEqual(["first.ts:1:9", "fourth.js:3:9", "second.ts:2:9"]);
    expect(exitCode).toBe(2);
  });

  test.concurrent("bun run --lint checks the files after `run`", async () => {
    using dir = tempDir("lint-run", {
      "clean.ts": 'console.log("executed");\nexport const answer: number = 42;\n',
      "first.ts": "let x = ;\n",
      "second.ts": "\nlet y = ;\n",
    });
    const [clean, failing] = await Promise.all([
      bun(String(dir), ["run", "--lint", "clean.ts"]),
      bun(String(dir), ["run", "--lint", "first.ts", "second.ts"]),
    ]);
    expect(clean).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(failing.stdout).toBe("");
    expect(positions(failing.stderr)).toEqual(["first.ts:1:9", "second.ts:2:9"]);
    expect(failing.exitCode).toBe(2);
  });

  test.concurrent("a missing file and an unsupported extension are reported and the next file is checked", async () => {
    using dir = tempDir("lint-unreadable", { "notes.txt": "let x = 1;\n", "bad.ts": "let x = ;\n" });
    const operands = ["missing.ts", "missing.d.ts", "notes.txt", "bad.ts"];
    const { stdout, stderr, exitCode } = await bun(String(dir), ["--lint", ...operands]);
    expect(stdout).toBe("");
    expect(stderr).toContain("File 'missing.ts' not found.");
    expect(stderr).toContain("File 'missing.d.ts' not found.");
    expect(stderr).toContain(unsupportedExtension("notes.txt"));
    expect(positions(stderr)).toEqual(["bad.ts:1:9"]);
    expect(exitCode).toBe(2);
  });

  test.concurrent("without a file it is a usage error and the exit code is 1", async () => {
    using dir = tempDir("lint-no-operand", {});
    const expected = { stdout: "", stderr: "error: --lint needs one or more files\n", exitCode: 1 };
    const [auto, run] = await Promise.all([bun(String(dir), ["--lint"]), bun(String(dir), ["run", "--lint"])]);
    expect(auto).toEqual(expected);
    expect(run).toEqual(expected);
  });

  test.concurrent("each extension is parsed with its own loader", async () => {
    const plain = "let answer = 42;\nconsole.log(answer);\n";
    const typed = "let answer: number = 42;\nconsole.log(answer);\n";
    const jsx = "console.log(<div>hi</div>);\n";
    // What the loader of each extension takes.
    const loaders = {
      js: { types: false, jsx: true },
      jsx: { types: false, jsx: true },
      mjs: { types: false, jsx: false },
      cjs: { types: false, jsx: false },
      ts: { types: true, jsx: false },
      mts: { types: true, jsx: false },
      cts: { types: true, jsx: false },
      tsx: { types: true, jsx: true },
    };
    // A constant of a declaration file has no initializer.
    const files: Record<string, string> = {
      "ambient.d.ts": "export const x: number;\n",
      "ambient.d.mts": "export const x: number;\n",
      "ambient.d.cts": "export const x: number;\n",
    };
    const rejected: string[] = [];
    for (const [extension, takes] of Object.entries(loaders)) {
      files[`plain.${extension}`] = plain;
      files[`typed.${extension}`] = typed;
      files[`jsx.${extension}`] = jsx;
      if (!takes.types) rejected.push(`typed.${extension}`);
      if (!takes.jsx) rejected.push(`jsx.${extension}`);
    }
    const accepted = Object.keys(files).filter(file => !rejected.includes(file));
    using dir = tempDir("lint-extensions", files);

    const [clean, all] = await Promise.all([
      bun(String(dir), ["--lint", ...accepted]),
      bun(String(dir), ["--lint", ...Object.keys(files)]),
    ]);
    expect(clean).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(all.stdout).toBe("");
    const reported = new Set(positions(all.stderr).map(position => position.slice(0, position.indexOf(":"))));
    expect([...reported].sort()).toEqual(rejected.sort());
    expect(all.exitCode).toBe(2);
  });
});
