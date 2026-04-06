import { describe, expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import path from "path";

(isWindows ? describe : describe.concurrent)("bun init", () => {
  test("bun init works", async () => {
    const temp = tempDirWithFiles("bun-init-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toEqual({
      "name": path.basename(temp).toLowerCase().replaceAll(" ", "-"),
      "module": "index.ts",
      "type": "module",
      "private": true,
      "devDependencies": {
        "@types/bun": "latest",
      },
      "peerDependencies": {
        "typescript": "^5",
      },
    });
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");

    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  }, 30_000);

  test("bun init with piped cli", async () => {
    const temp = tempDirWithFiles("bun-init-with-piped-cli", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init"],
      cwd: temp,
      stdio: [new Blob(["\n\n\n\n\n\n\n\n\n\n\n\n"]), "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toEqual({
      "name": path.basename(temp).toLowerCase().replaceAll(" ", "-"),
      "module": "index.ts",
      "private": true,
      "type": "module",
      "devDependencies": {
        "@types/bun": "latest",
      },
      "peerDependencies": {
        "typescript": "^5",
      },
    });
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");

    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  }, 30_000);

  // These snapshot tests compare `readdirSync` against an inline list that
  // does not include any agent rule files, so they have to run with
  // Claude/Cursor detection disabled — otherwise a developer with Cursor
  // installed (or `claude` on $PATH) would see `.cursor/` or `CLAUDE.md`
  // sneak into the listing.
  const noAgentRulesEnv = {
    ...bunEnv,
    CLAUDE_CODE_AGENT_RULE_DISABLED: "1",
    CURSOR_AGENT_RULE_DISABLED: "1",
  };

  test("bun init in folder", async () => {
    const temp = tempDirWithFiles("bun-init-in-folder", {
      "mydir": {
        "index.ts": "// mydir/index.ts",
        "README.md": "// mydir/README.md",
        ".gitignore": "// mydir/.gitignore",
        "package.json": '{ "name": "mydir" }',
        "tsconfig.json": "// mydir/tsconfig.json",
      },
    });
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: noAgentRulesEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  });

  test("bun init error rather than overwriting file", async () => {
    const temp = tempDirWithFiles("bun-init-error-rather-than-overwriting-file", {
      "mydir": "don't delete me!!!",
    });
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: bunEnv,
    });
    expect(await exited).not.toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(await Bun.file(path.join(temp, "mydir")).text()).toBe("don't delete me!!!");
  });

  test("bun init utf-8", async () => {
    const temp = tempDirWithFiles("bun-init-utf-8", {});
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "u t f ∞™/subpath"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: noAgentRulesEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["u t f ∞™"]);
    expect(readdirSync(path.join(temp, "u t f ∞™")).sort()).toEqual(["subpath"]);
    expect(readdirSync(path.join(temp, "u t f ∞™/subpath")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  });

  test("bun init twice", async () => {
    const temp = tempDirWithFiles("bun-init-twice", {});
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: noAgentRulesEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
    await Bun.write(path.join(temp, "mydir/index.ts"), "my edited index.ts");
    await Bun.write(path.join(temp, "mydir/README.md"), "my edited README.md");
    await Bun.write(path.join(temp, "mydir/.gitignore"), "my edited .gitignore");
    await Bun.write(
      path.join(temp, "mydir/package.json"),
      JSON.stringify({
        ...(await Bun.file(path.join(temp, "mydir/package.json")).json()),
        name: "my edited package.json",
      }),
    );
    await Bun.write(path.join(temp, "mydir/tsconfig.json"), `my edited tsconfig.json`);
    const { exited: exited2, stderr } = Bun.spawn({
      cmd: [bunExe(), "init", "mydir"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: noAgentRulesEnv,
    });
    expect(await exited2).toBe(0);
    expect(await stderr.text()).toMatchInlineSnapshot(`
    "note: package.json already exists, configuring existing project
    "
  `);
    expect(await exited2).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
    expect(await Bun.file(path.join(temp, "mydir/index.ts")).text()).toMatchInlineSnapshot(`"my edited index.ts"`);
    expect(await Bun.file(path.join(temp, "mydir/README.md")).text()).toMatchInlineSnapshot(`"my edited README.md"`);
    expect(await Bun.file(path.join(temp, "mydir/.gitignore")).text()).toMatchInlineSnapshot(`"my edited .gitignore"`);
    expect(await Bun.file(path.join(temp, "mydir/package.json")).json()).toMatchInlineSnapshot(`
    {
      "devDependencies": {
        "@types/bun": "latest",
      },
      "module": "index.ts",
      "name": "my edited package.json",
      "peerDependencies": {
        "typescript": "^5",
      },
      "private": true,
      "type": "module",
    }
  `);
    expect(await Bun.file(path.join(temp, "mydir/tsconfig.json")).text()).toMatchInlineSnapshot(
      `"my edited tsconfig.json"`,
    );
  });

  test("bun init --react works", async () => {
    const temp = tempDirWithFiles("bun-init--react-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  }, 30_000);

  test("bun init --react=tailwind works", async () => {
    const temp = tempDirWithFiles("bun-init--react=tailwind-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=tailwind"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
    expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
  }, 30_000);

  test("bun init --react=shadcn works", async () => {
    const temp = tempDirWithFiles("bun-init--react=shadcn-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=shadcn"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("dependencies.@radix-ui/react-slot");
    expect(pkg).toHaveProperty("dependencies.class-variance-authority");
    expect(pkg).toHaveProperty("dependencies.clsx");
    expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/components"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/components/ui"))).toBe(true);
  }, 30_000);

  test("bun init --minimal only creates package.json and tsconfig.json", async () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26050
    // --minimal should not create .cursor/, CLAUDE.md, AGENTS.md, .gitignore, or README.md
    const temp = tempDirWithFiles("bun-init-minimal", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--minimal", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...bunEnv,
        // Simulate Cursor being installed via CURSOR_TRACE_ID env var
        CURSOR_TRACE_ID: "test-trace-id",
      },
    });

    expect(await exited).toBe(0);

    // Should create package.json and tsconfig.json
    expect(fs.existsSync(path.join(temp, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);

    // Should NOT create these extra files with --minimal
    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(false);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(temp, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(temp, ".cursor"))).toBe(false);
  });

  // Feature: https://github.com/oven-sh/bun/issues/28909
  //
  // `bun init` writes an `AGENTS.md` (https://agents.md/) as the single source
  // of truth. When Claude Code or Cursor is detected, their rule files become
  // symlinks to `AGENTS.md` so the content stays in sync.
  describe("AGENTS.md", () => {
    // First non-empty line of the rule body. Used as a sanity check that
    // the frontmatter was stripped.
    const AGENTS_MD_BODY_FIRST_LINE = "Default to using Bun instead of Node.js.";
    // A line that only appears in the YAML frontmatter.
    const FRONTMATTER_LINE = "alwaysApply:";

    // Create a stub `claude` executable in a dedicated bin dir. `bun init`
    // uses `which("claude")` to detect Claude Code, so a zero-byte script on
    // $PATH is enough. Returns a { PATH } env fragment that points to the
    // stub; if `haveClaude` is false, points at an empty dir so no `claude`
    // binary is discoverable (even if the host happens to have one).
    function claudeEnv(temp: string, haveClaude: boolean) {
      const binDir = path.join(temp, haveClaude ? ".stub-bin-with-claude" : ".stub-bin-empty");
      fs.mkdirSync(binDir, { recursive: true });
      if (haveClaude) {
        const stub = path.join(binDir, "claude");
        fs.writeFileSync(stub, "#!/bin/sh\nexit 0\n");
        fs.chmodSync(stub, 0o755);
      }
      return { PATH: binDir };
    }

    test("default: writes AGENTS.md with frontmatter stripped, no CLAUDE.md, no .cursor/", async () => {
      const temp = tempDirWithFiles("bun-init-agents-default", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, false),
          CLAUDE_CODE_AGENT_RULE_DISABLED: "1",
          CURSOR_AGENT_RULE_DISABLED: "1",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(false);
      expect(fs.existsSync(path.join(temp, ".cursor"))).toBe(false);

      const contents = fs.readFileSync(path.join(temp, "AGENTS.md"), "utf8");
      // Frontmatter is stripped — body starts with the standard first line.
      expect(contents).not.toInclude(FRONTMATTER_LINE);
      expect(contents.trimStart()).toStartWith(AGENTS_MD_BODY_FIRST_LINE);
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)("with Claude detected via $PATH: CLAUDE.md is a symlink to AGENTS.md", async () => {
      const temp = tempDirWithFiles("bun-init-agents-claude", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, true),
          CURSOR_AGENT_RULE_DISABLED: "1",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(true);
      expect(fs.lstatSync(path.join(temp, "CLAUDE.md")).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(temp, "CLAUDE.md"))).toBe("AGENTS.md");
      // Following the symlink reaches AGENTS.md content.
      expect(fs.readFileSync(path.join(temp, "CLAUDE.md"), "utf8")).toBe(
        fs.readFileSync(path.join(temp, "AGENTS.md"), "utf8"),
      );
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)("with Claude detected via CLAUDECODE=1: CLAUDE.md is a symlink to AGENTS.md", async () => {
      // Claude Code sets `CLAUDECODE=1` in every child process it spawns.
      // Detection should work even when `claude` is not on $PATH, which is
      // the common case inside containerised agent sessions.
      const temp = tempDirWithFiles("bun-init-agents-claudecode-env", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, false),
          CLAUDECODE: "1",
          CURSOR_AGENT_RULE_DISABLED: "1",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(true);
      expect(fs.lstatSync(path.join(temp, "CLAUDE.md")).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(temp, "CLAUDE.md"))).toBe("AGENTS.md");
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)(
      "with Cursor detected: .cursor/rules/*.mdc is a real file with frontmatter intact",
      async () => {
        // Cursor needs the YAML `globs` field to know when to activate the
        // rule. AGENTS.md has the frontmatter stripped, so we can't share
        // content via symlink — the cursor rule is always a real file.
        const temp = tempDirWithFiles("bun-init-agents-cursor", {});

        await using proc = Bun.spawn({
          cmd: [bunExe(), "init", "-y"],
          cwd: temp,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...bunEnv,
            ...claudeEnv(temp, false),
            CLAUDE_CODE_AGENT_RULE_DISABLED: "1",
            CURSOR_TRACE_ID: "test-trace-id",
          },
        });
        const exitCode = await proc.exited;

        expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(true);
        const cursorRulePath = path.join(temp, ".cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc");
        expect(fs.existsSync(cursorRulePath)).toBe(true);
        const cursorStat = fs.lstatSync(cursorRulePath);
        expect(cursorStat.isSymbolicLink()).toBe(false);
        expect(cursorStat.isFile()).toBe(true);
        const cursorContents = fs.readFileSync(cursorRulePath, "utf8");
        // The cursor rule keeps its full YAML frontmatter — without `globs`
        // Cursor does not know which file types to activate on.
        expect(cursorContents).toInclude(FRONTMATTER_LINE);
        expect(cursorContents).toInclude("globs:");
        expect(cursorContents).toInclude(AGENTS_MD_BODY_FIRST_LINE);
        expect(exitCode).toBe(0);
      },
    );

    test("BUN_AGENTS_MD_DISABLED=1: no AGENTS.md is written", async () => {
      const temp = tempDirWithFiles("bun-init-agents-disabled", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, false),
          BUN_AGENTS_MD_DISABLED: "1",
          CLAUDE_CODE_AGENT_RULE_DISABLED: "1",
          CURSOR_AGENT_RULE_DISABLED: "1",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(false);
      // Other expected files still land — just checking we didn't break init.
      expect(fs.existsSync(path.join(temp, "package.json"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)("BUN_AGENTS_MD_DISABLED=1 with Claude: CLAUDE.md falls back to a real file", async () => {
      const temp = tempDirWithFiles("bun-init-agents-disabled-claude", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, true),
          BUN_AGENTS_MD_DISABLED: "1",
          CURSOR_AGENT_RULE_DISABLED: "1",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(false);
      // CLAUDE.md exists as a regular file (not a symlink), with the
      // frontmatter stripped.
      expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(true);
      const claudeStat = fs.lstatSync(path.join(temp, "CLAUDE.md"));
      expect(claudeStat.isSymbolicLink()).toBe(false);
      expect(claudeStat.isFile()).toBe(true);
      const claude = fs.readFileSync(path.join(temp, "CLAUDE.md"), "utf8");
      expect(claude).not.toInclude(FRONTMATTER_LINE);
      expect(claude.trimStart()).toStartWith(AGENTS_MD_BODY_FIRST_LINE);
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)(
      "BUN_AGENTS_MD_DISABLED=1 with pre-existing AGENTS.md: CLAUDE.md is a real file, not a symlink",
      async () => {
        // Regression guard: when the user has an AGENTS.md from a prior init
        // and later opts out via `BUN_AGENTS_MD_DISABLED=1`, we must not
        // treat the existing file as a symlink target — the user wants the
        // old standalone-file workflow back.
        const temp = tempDirWithFiles("bun-init-agents-disabled-existing", {
          "AGENTS.md": "# stale content\n",
        });

        await using proc = Bun.spawn({
          cmd: [bunExe(), "init", "-y"],
          cwd: temp,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...bunEnv,
            ...claudeEnv(temp, true),
            BUN_AGENTS_MD_DISABLED: "1",
            CURSOR_AGENT_RULE_DISABLED: "1",
          },
        });
        const exitCode = await proc.exited;

        // AGENTS.md is untouched (never overwritten).
        expect(fs.readFileSync(path.join(temp, "AGENTS.md"), "utf8")).toBe("# stale content\n");
        // CLAUDE.md is a real file with the full rule body, not a symlink
        // to the stale AGENTS.md above.
        expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(true);
        const claudeStat = fs.lstatSync(path.join(temp, "CLAUDE.md"));
        expect(claudeStat.isSymbolicLink()).toBe(false);
        expect(claudeStat.isFile()).toBe(true);
        const claude = fs.readFileSync(path.join(temp, "CLAUDE.md"), "utf8");
        expect(claude.trimStart()).toStartWith(AGENTS_MD_BODY_FIRST_LINE);
        expect(exitCode).toBe(0);
      },
    );

    test("BUN_AGENTS_MD_DISABLED=1 with Cursor: cursor rule still gets written with frontmatter", async () => {
      // Verifies the .cursor/rules parent directory is created even when we
      // bypass the AGENTS.md path entirely — regression guard for a latent
      // ENOENT in the direct-file write.
      const temp = tempDirWithFiles("bun-init-agents-disabled-cursor", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, false),
          BUN_AGENTS_MD_DISABLED: "1",
          CLAUDE_CODE_AGENT_RULE_DISABLED: "1",
          CURSOR_TRACE_ID: "test-trace-id",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(false);
      const cursorRulePath = path.join(temp, ".cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc");
      expect(fs.existsSync(cursorRulePath)).toBe(true);
      const cursorContents = fs.readFileSync(cursorRulePath, "utf8");
      expect(cursorContents).toInclude(FRONTMATTER_LINE);
      expect(cursorContents).toInclude("globs:");
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)(
      "existing AGENTS.md is never overwritten; CLAUDE.md symlink still points at it",
      async () => {
        const customContent = "# my custom agent rules\n\ndon't clobber me\n";
        const temp = tempDirWithFiles("bun-init-agents-existing", {
          "AGENTS.md": customContent,
        });

        await using proc = Bun.spawn({
          cmd: [bunExe(), "init", "-y"],
          cwd: temp,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...bunEnv,
            ...claudeEnv(temp, true),
            CURSOR_AGENT_RULE_DISABLED: "1",
          },
        });
        const exitCode = await proc.exited;

        expect(fs.readFileSync(path.join(temp, "AGENTS.md"), "utf8")).toBe(customContent);
        // Claude symlink still gets created, pointing at the user's file.
        expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(true);
        expect(fs.lstatSync(path.join(temp, "CLAUDE.md")).isSymbolicLink()).toBe(true);
        expect(fs.readlinkSync(path.join(temp, "CLAUDE.md"))).toBe("AGENTS.md");
        expect(fs.readFileSync(path.join(temp, "CLAUDE.md"), "utf8")).toBe(customContent);
        expect(exitCode).toBe(0);
      },
    );

    test("BUN_AGENT_RULE_DISABLED=1: master kill switch — no agent files at all", async () => {
      const temp = tempDirWithFiles("bun-init-agents-master-off", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", "-y"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...bunEnv,
          ...claudeEnv(temp, true),
          BUN_AGENT_RULE_DISABLED: "1",
          CURSOR_TRACE_ID: "test-trace-id",
        },
      });
      const exitCode = await proc.exited;

      expect(fs.existsSync(path.join(temp, "AGENTS.md"))).toBe(false);
      expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(false);
      expect(fs.existsSync(path.join(temp, ".cursor"))).toBe(false);
      expect(exitCode).toBe(0);
    });
  });
});
