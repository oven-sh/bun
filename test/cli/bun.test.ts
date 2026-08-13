import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import { tmpdir } from "node:os";

describe("bun", () => {
  describe("NO_COLOR", () => {
    for (const value of ["1", "0", "foo", " "]) {
      test(`respects NO_COLOR=${JSON.stringify(value)} to disable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env: {
            NO_COLOR: value,
          },
        });
        expect(stdout.toString()).not.toMatch(/\u001b\[\d+m/);
      });
    }
    for (const value of ["", undefined]) {
      // TODO: need a way to fake a tty in order to test this,
      // and cannot use FORCE_COLOR since that will always override NO_COLOR.
      test.todo(`respects NO_COLOR=${JSON.stringify(value)} to enable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env:
            value === undefined
              ? {}
              : {
                  NO_COLOR: value,
                },
        });
        expect(stdout.toString()).toMatch(/\u001b\[\d+m/);
      });
    }
  });

  describe("revision", () => {
    test("revision generates version numbers correctly", () => {
      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--version"],
        env: bunEnv,
        stderr: "inherit",
      });
      var version = stdout.toString().trim();

      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--revision"],
        env: bunEnv,
        stderr: "inherit",
      });
      var revision = stdout.toString().trim();

      expect(exitCode).toBe(0);
      expect(revision).toStartWith(version);
      // https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
      expect(revision).toMatch(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
      );
    });
  });
  describe("getcompletes", () => {
    test("getcompletes should not panic and should not be empty", () => {
      const { stdout, exitCode } = spawnSync({
        cmd: [bunExe(), "getcompletes"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toBeEmpty();
    });

    // https://github.com/oven-sh/bun/issues/30086
    test("getcompletes keeps scripts whose names start with 'pre'/'post' when no sibling script exists", () => {
      using dir = tempDir("getcompletes-pre-post", {
        "package.json": JSON.stringify({
          name: "test",
          scripts: {
            // standalone scripts — nothing named `ttier`, `pare-release`, `gres`, `css`, `view`
            "prettier": "echo prettier",
            "prettier:fix": "echo prettier:fix",
            "prepare-release": "echo prepare-release",
            "postgres": "echo postgres",
            "postcss": "echo postcss",
            "preview": "echo preview",
            // plain scripts
            "build": "echo build",
            "dev": "echo dev",
            "lint": "echo lint",
            "lint:fix": "echo lint:fix",
            "fix": "echo fix",
            "test": "echo test",
            // real lifecycle hooks — these SHOULD be hidden (sibling exists)
            "prebuild": "echo prebuild",
            "postbuild": "echo postbuild",
            "pretest": "echo pretest",
          },
        }),
      });

      for (const filter of ["s", "i", "r", "g", "z"]) {
        const { stdout, exitCode } = spawnSync({
          cmd: [bunExe(), "getcompletes", filter],
          env: bunEnv,
          cwd: String(dir),
        });
        const lines = stdout
          .toString()
          .split("\n")
          .map(l => l.split("\t")[0]) // "z" filter emits "name\tdescription"
          .filter(Boolean);

        // standalone pre/post-prefixed scripts must be present
        expect(lines).toContain("prettier");
        expect(lines).toContain("prettier:fix");
        expect(lines).toContain("prepare-release");
        expect(lines).toContain("postgres");
        expect(lines).toContain("postcss");
        expect(lines).toContain("preview");

        // real npm lifecycle hooks (sibling `build`/`test` exists) must still be hidden
        expect(lines).not.toContain("prebuild");
        expect(lines).not.toContain("postbuild");
        expect(lines).not.toContain("pretest");

        expect(exitCode).toBe(0);
      }
    });
  });
  describe("--help preserves <placeholder> text", () => {
    const env = { ...bunEnv, NO_COLOR: "1" };
    const usage: [string, string][] = [
      ["install", "bun install [flags] <name>@<version>"],
      ["add", "bun add [flags] <package><@version>"],
      ["remove", "bun remove [flags] [<packages>]"],
      ["update", "bun update [flags] <name>@<version>"],
      ["link", "bun link [flags] [<packages>]"],
      ["patch", "bun patch [flags or options] <package>@<version>"],
      ["patch-commit", "bun patch-commit [flags or options] <directory>"],
      ["info", "bun info [flags] <package>[@<version>]"],
    ];
    test.concurrent.each(usage)("bun %s --help usage line", async (cmd, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.startsWith("Usage:")) ?? "";
      expect(line).toBe(`Usage: ${expected}`);
      expect(exitCode).toBe(0);
    });

    const flags: [string, string, string][] = [
      ["audit", "--audit-level", "greater than or equal to <level> (low,"],
      ["test", "--rerun-each", "Re-run each test file <NUMBER> times"],
      ["test", "--bail", "Exit the test suite after <NUMBER> failures"],
      ["build", "--allow-unresolved", "Use '<empty>' for opaque specifiers"],
    ];
    test.concurrent.each(flags)("bun %s --help keeps placeholder in %s description", async (cmd, flag, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.includes(flag)) ?? "";
      expect(line).toContain(expected);
      expect(exitCode).toBe(0);
    });

    test("bun add --help usage line is intact with FORCE_COLOR=1", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "add", "--help"],
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout + stderr;
      // <blue>\<package\><r> renders to \x1b[34m<package>\x1b[0m, not \x1b[34m\x1b[0m
      expect(out).toContain("\x1b[34m<package>\x1b[0m");
      // raw tag markup must not leak through
      expect(out).not.toContain("<blue>");
      expect(exitCode).toBe(0);
    });
  });

  describe("--loader help text", () => {
    // The names the -l/--loader help text in src/runtime/cli/Arguments.rs advertises. The same
    // list is repeated in docs/snippets/cli/run.mdx, docs/runtime/bunfig.mdx and completions/bun.{zsh,bash}.
    const advertisedLoaders = [
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "toml",
      "yaml",
      "json5",
      "xml",
      "text",
      "md",
      "css",
      "html",
      "wasm",
      "napi",
      "sqlite",
      "file",
    ];

    test.concurrent.each([
      ["bun --help", ["--help"]],
      ["bun run --help", ["run", "--help"]],
    ])("%s lists the loaders --loader accepts", async (_, args) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const loaderLine = stdout.split(/\r?\n/).find(line => line.includes("--loader"));
      expect(loaderLine).toBeDefined();
      const [, listed] = loaderLine!.split("Valid loaders:");
      expect(listed?.split(",").map(name => name.trim())).toEqual(advertisedLoaders);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "every advertised loader name is accepted by --loader and applied to the mapped extension",
      async () => {
        using dir = tempDir("loader-help-names", {
          "m.l_js": `export default "js";`,
          "m.l_jsx": `export default "jsx";`,
          "m.l_ts": `export default "ts" as string;`,
          "m.l_tsx": `export default "tsx" as string;`,
          "m.l_json": `{ "kind": "json" }`,
          "m.l_toml": `kind = "toml"`,
          "m.l_yaml": `kind: yaml`,
          "m.l_json5": `{ kind: "json5", /* json5 allows this */ }`,
          "m.l_xml": `<kind>xml</kind>`,
          "m.l_text": `plain text`,
          "m.l_md": `# md`,
          "m.l_css": `a { color: red }`,
          "m.l_html": `<!doctype html><p>html</p>`,
          "m.l_sqlite": "",
          "m.l_file": `not a module`,
          "main.ts": `
          import { Database } from "bun:sqlite";
          import { basename } from "node:path";
          import js from "./m.l_js";
          import jsx from "./m.l_jsx";
          import ts from "./m.l_ts";
          import tsx from "./m.l_tsx";
          import json from "./m.l_json";
          import toml from "./m.l_toml";
          import yaml from "./m.l_yaml";
          import json5 from "./m.l_json5";
          import xml from "./m.l_xml";
          import text from "./m.l_text";
          import md from "./m.l_md";
          import css from "./m.l_css";
          import html from "./m.l_html";
          import db from "./m.l_sqlite";
          import file from "./m.l_file";
          console.log(
            JSON.stringify({
              js, jsx, ts, tsx, json, toml, yaml, json5, xml, text, md,
              css: typeof css,
              html: Object.prototype.toString.call(html),
              sqlite: db instanceof Database,
              file: basename(file),
            }),
          );
        `,
        });

        await using proc = Bun.spawn({
          // Without these flags every fixture falls back to the file loader and imports as a path.
          // wasm and napi have no fixture: an unknown name fails argument parsing, so mapping
          // them is what the test checks for those two.
          cmd: [bunExe(), ...advertisedLoaders.flatMap(name => ["--loader", `.l_${name}:${name}`]), "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          js: "js",
          jsx: "jsx",
          ts: "ts",
          tsx: "tsx",
          json: { kind: "json" },
          toml: { kind: "toml" },
          yaml: { kind: "yaml" },
          json5: { kind: "json5" },
          xml: { kind: "xml" },
          text: "plain text",
          md: "<h1>md</h1>\n",
          css: "object",
          html: "[object HTMLBundle]",
          sqlite: true,
          file: "m.l_file",
        });
        expect(exitCode).toBe(0);
      },
    );
  });
  describe("test command line arguments", () => {
    test("test --config, issue #4128", () => {
      const path = `${tmpdir()}/bunfig-${Date.now()}.toml`;
      fs.writeFileSync(path, "[debug]");

      const p = Bun.spawnSync({
        cmd: [bunExe(), "--config=" + path],
        env: {},
        stderr: "inherit",
      });
      try {
        expect(p.exitCode).toBe(0);
      } finally {
        fs.unlinkSync(path);
      }
    });
  });
});
