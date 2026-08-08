// https://github.com/oven-sh/bun/issues/10429
// Importing through a symlink must pick the loader from the symlink's
// extension, not the target's.
import { describe, expect, test } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("symlink import picks loader from the symlink's extension", () => {
  test(".txt symlink -> .html target loads as text", async () => {
    using dir = tempDir("issue-10429-txt-to-html", {
      "template.html": "<html></html>\n",
      "index.ts": /* ts */ `
        import t from "./template.txt";
        if (typeof t !== "string") {
          throw new Error("expected string, got " + typeof t + " " + String(t));
        }
        console.log(JSON.stringify({ type: typeof t, value: t }));
      `,
    });
    symlinkSync(join(String(dir), "template.html"), join(String(dir), "template.txt"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("HTMLBundle");
    expect(JSON.parse(stdout.trim())).toEqual({ type: "string", value: "<html></html>\n" });
    expect(exitCode).toBe(0);
  });

  test(".json symlink -> .txt target loads as JSON", async () => {
    using dir = tempDir("issue-10429-json-to-txt", {
      "data.txt": `{"a":1}`,
      "index.ts": /* ts */ `
        import d from "./data.json";
        console.log(JSON.stringify({ type: typeof d, value: d }));
      `,
    });
    symlinkSync(join(String(dir), "data.txt"), join(String(dir), "data.json"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ type: "object", value: { a: 1 } });
    expect(exitCode).toBe(0);
  });

  test(".txt symlink -> .ts target loads as text, not transpiled", async () => {
    using dir = tempDir("issue-10429-txt-to-ts", {
      "mod.ts": `export const x: number = 1;\n`,
      "index.ts": /* ts */ `
        import src from "./mod.txt";
        console.log(JSON.stringify({ type: typeof src, hasTypeAnnotation: src.includes(": number") }));
      `,
    });
    symlinkSync(join(String(dir), "mod.ts"), join(String(dir), "mod.txt"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ type: "string", hasTypeAnnotation: true });
    expect(exitCode).toBe(0);
  });

  test("symlink with same extension as target still dedupes via realpath", async () => {
    // When the extensions match, the module key stays the realpath so
    // importing through the symlink and through the target yield one module
    // instance (side effects run once).
    using dir = tempDir("issue-10429-same-ext", {
      "real.mjs": `globalThis.__hits = (globalThis.__hits || 0) + 1; export const hits = globalThis.__hits;`,
      "index.ts": /* ts */ `
        const a = await import("./link.mjs");
        const b = await import("./real.mjs");
        console.log(JSON.stringify({ same: a === b, hits: globalThis.__hits }));
      `,
    });
    symlinkSync(join(String(dir), "real.mjs"), join(String(dir), "link.mjs"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ same: true, hits: 1 });
    expect(exitCode).toBe(0);
  });

  test("extensionless symlink -> .js target still loads as JS", async () => {
    // If the symlink has no extension of its own, fall back to the target's.
    using dir = tempDir("issue-10429-no-ext", {
      "real.js": `module.exports = 42;`,
      "index.ts": /* ts */ `
        const v = require("./script");
        console.log(JSON.stringify({ value: v }));
      `,
    });
    symlinkSync(join(String(dir), "real.js"), join(String(dir), "script"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ value: 42 });
    expect(exitCode).toBe(0);
  });

  test("dotfile symlink -> .json target keeps the target's loader", async () => {
    // A leading-dot-only basename (.babelrc) has no extension, so the guard
    // falls back to the realpath and the .json loader applies.
    using dir = tempDir("issue-10429-dotfile", {
      "babelrc.json": `{"presets":["env"]}`,
      "index.ts": /* ts */ `
        const cfg = require("./.babelrc");
        console.log(JSON.stringify({ type: typeof cfg, presets: cfg.presets }));
      `,
    });
    symlinkSync(join(String(dir), "babelrc.json"), join(String(dir), ".babelrc"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ type: "object", presets: ["env"] });
    expect(exitCode).toBe(0);
  });
});
