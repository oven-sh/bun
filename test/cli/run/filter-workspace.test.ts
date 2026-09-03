import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tempDirWithFiles,
  type DirectoryTree,
} from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "path";

// Shared read-only workspace. Every test that runs a script here only reads
// the tree, so the concurrent tests below can share it.
const cwd_root = tempDirWithFiles("testworkspace", {
  packages: {
    pkga: {
      "package.json": JSON.stringify({ name: "pkga", scripts: { present: "echo scripta" } }),
    },
    scoped: {
      "package.json": JSON.stringify({ name: "@scoped/scoped", scripts: { present: "echo scriptd" } }),
    },
    pkgb: {
      "package.json": JSON.stringify({ name: "pkgb", scripts: { present: "echo scriptb" } }),
    },
    dirname: {
      "package.json": JSON.stringify({ name: "pkgc", scripts: { present: "echo scriptc" } }),
    },
    malformed1: {
      "package.json": JSON.stringify({ scripts: { present: "echo malformed1" } }),
    },
    malformed2: {
      "package.json": "asdfsadfas",
    },
    missing: {
      foo: "bar",
    },
  },
  "package.json": JSON.stringify({
    name: "ws",
    scripts: { present: "echo rootscript" },
    workspaces: ["packages/*"],
  }),
});

// Edges: web -> api -> shared -> pkg-a; pkg-b and the root are isolated.
// `shared` has no scripts, so it never shows up in the output even when selected.
const graph_root = tempDirWithFiles("filter-selectors", {
  packages: {
    web: {
      "package.json": JSON.stringify({
        name: "web",
        dependencies: { api: "workspace:*" },
        scripts: { present: "echo out-web" },
      }),
    },
    api: {
      "package.json": JSON.stringify({
        name: "api",
        devDependencies: { shared: "workspace:*" },
        scripts: { present: "echo out-api" },
      }),
    },
    shared: {
      "package.json": JSON.stringify({
        name: "shared",
        dependencies: { "pkg-a": "*" },
      }),
    },
    "pkg-a": {
      "package.json": JSON.stringify({ name: "pkg-a", scripts: { present: "echo out-pkg-a" } }),
    },
    "pkg-b": {
      "package.json": JSON.stringify({ name: "pkg-b", scripts: { present: "echo out-pkg-b" } }),
    },
  },
  "package.json": JSON.stringify({
    name: "ws",
    workspaces: ["packages/*"],
    scripts: { present: "echo out-root" },
  }),
});

const cwd_packages = join(cwd_root, "packages");

// Discovery of `cwd_root` always trips over packages/malformed2/package.json.
const malformedWarning = `warn: Failed to read "<dir>/packages/malformed2/package.json", skipping this workspace package`;

// A 20-line script. The lines are distinct so the elision tests can tell
// which lines were kept.
const twentyLines = "seq 1 20";

// The trailing newline matters: the plain renderer prints a final unterminated
// line without the script name.
const writeSuccess = `await Bun.write("out.txt", "success\\n");`;

// Used by two packages whose scripts must run at the same time: each side
// writes its own marker, then waits for the other side's marker. If the
// runner serialized the two scripts, the first one would never see the
// second one's marker and would exit 1 at the deadline.
const rendezvous = `
  const [me, other] = process.argv.slice(2);
  await Bun.write(\`../\${me}.ready\`, "");
  const deadline = Date.now() + 10_000;
  while (!(await Bun.file(\`../\${other}.ready\`).exists())) {
    if (Date.now() > deadline) {
      console.log(\`\${me} never saw \${other}\`);
      process.exit(1);
    }
    await Bun.sleep(5);
  }
  console.log(\`\${me} saw \${other}\`);
`;

async function run(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Scripts of unrelated packages run at the same time, so the order of their
// lines is not fixed. Sorting keeps the comparison exact.
function sorted(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .sort();
}

// The piped (non-terminal) output of one finished script: every line it
// printed, then its exit status, each prefixed with "<package> <script>: ".
function finished(script: string, outputs: Record<string, string | string[]>, code = 0): string[] {
  return Object.entries(outputs)
    .flatMap(([pkg, lines]) => [
      ...[lines].flat().map(line => `${pkg} ${script}: ${line}`),
      `${pkg} ${script}: Exited with code ${code}`,
    ])
    .sort();
}

// The terminal renderer repaints the whole run on every chunk of output, so
// a pipe captures one frame per repaint. Only the last frame, drawn after
// the script finished, is independent of how the output was chunked.
function lastFrame(stdout: string): string {
  const start = stdout.lastIndexOf("\x1b[?2026h");
  expect(start).toBeGreaterThanOrEqual(0);
  return stdout
    .slice(start)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/Done in (?:\d+ ms|\d+\.\d{2} s)/, "Done in <time>")
    .trimEnd();
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

describe.concurrent("bun", () => {
  const scripts = { pkga: "scripta", pkgb: "scriptb", pkgc: "scriptc", "@scoped/scoped": "scriptd" };
  const names = Object.keys(scripts);
  const cwds = {
    ".": cwd_root,
    packages: cwd_packages,
    "packages/pkga": join(cwd_packages, "pkga"),
    "packages/pkgb": join(cwd_packages, "pkgb"),
    "packages/dirname": join(cwd_packages, "dirname"),
    "packages/scoped": join(cwd_packages, "scoped"),
  };

  describe.each(Object.entries(cwds))("from %s", (_, cwd) => {
    test.each(Object.entries(scripts))("resolve %s", async (name, output) => {
      const { stdout, stderr, exitCode } = await run(cwd, ["run", "-F", name, "present"]);
      expect(sorted(stdout)).toEqual(finished("present", { [name]: output }));
      expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
      expect(exitCode).toBe(0);
    });

    test("resolve '*'", async () => {
      const { stdout, stderr, exitCode } = await run(cwd, ["run", "-F", "*", "present"]);
      expect(sorted(stdout)).toEqual(finished("present", scripts));
      expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
      expect(exitCode).toBe(0);
    });

    test("resolve all with one --filter per name", async () => {
      const filters = names.flatMap(name => ["--filter", name]);
      const { stdout, stderr, exitCode } = await run(cwd, ["run", ...filters, "present"]);
      expect(sorted(stdout)).toEqual(finished("present", scripts));
      expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
      expect(exitCode).toBe(0);
    });
  });

  // A path pattern also matches packages/malformed1, whose package.json has
  // no name: its lines carry an empty package name.
  const everyDirectory = { ...scripts, "": "malformed1" };

  test.each([
    ["bun --filter ./packages/*", ["--filter", "./packages/*", "present"]],
    ["bun run --filter ./packages/*", ["run", "--filter", "./packages/*", "present"]],
    ["bun run --filter ./**", ["run", "--filter", "./**", "present"]],
  ])("%s runs every package directory", async (_, args) => {
    const { stdout, stderr, exitCode } = await run(cwd_root, args);
    expect(sorted(stdout)).toEqual(finished("present", everyDirectory));
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
    expect(exitCode).toBe(0);
  });

  test("a directory glob selects only the matching directories", async () => {
    const { stdout, stderr, exitCode } = await run(cwd_root, ["run", "--filter", "./packages/pkg*", "present"]);
    expect(sorted(stdout)).toEqual(finished("present", { pkga: "scripta", pkgb: "scriptb" }));
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
    expect(exitCode).toBe(0);
  });

  test("a directory pattern selects a package.json without a name", async () => {
    const { stdout, stderr, exitCode } = await run(cwd_root, ["run", "--filter", "./packages/malformed1", "present"]);
    expect(sorted(stdout)).toEqual(finished("present", { "": "malformed1" }));
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
    expect(exitCode).toBe(0);
  });

  test("scripts of unrelated packages run in parallel", async () => {
    using dir = tempDir("filter-parallel", {
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      "packages/pkga/rendezvous.js": rendezvous,
      "packages/pkga/package.json": JSON.stringify({
        name: "pkga",
        scripts: { long: `${bunExe()} rendezvous.js pkga pkgb` },
      }),
      "packages/pkgb/rendezvous.js": rendezvous,
      "packages/pkgb/package.json": JSON.stringify({
        name: "pkgb",
        scripts: { long: `${bunExe()} rendezvous.js pkgb pkga` },
      }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "pkg*", "long"]);
    expect(sorted(stdout)).toEqual(finished("long", { pkga: "pkga saw pkgb", pkgb: "pkgb saw pkga" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Each step reads the file the previous step wrote, so a step that ran too
  // early fails on a missing file.
  test("run pre and post scripts, in order", async () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            prescript: "echo success > out.txt",
            script: "cat out.txt && echo great success > post.txt",
            postscript: "cat post.txt",
          },
        }),
      },
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "script"]);
    expect(sorted(stdout)).toEqual(
      [
        ...finished("prescript", { dep0: [] }),
        ...finished("script", { dep0: "success" }),
        ...finished("postscript", { dep0: "great success" }),
      ].sort(),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // The dependency needs a whole runtime start before it writes the file; the
  // dependent only needs `cat`. If both started together, the dependent would
  // read first and fail.
  const dependencyOrder = (dependency: string, dependent: string): DirectoryTree => ({
    [dependency]: {
      "write.js": writeSuccess,
      "package.json": JSON.stringify({
        name: dependency,
        scripts: { script: `${bunExe()} write.js` },
      }),
    },
    [dependent]: {
      "package.json": JSON.stringify({
        name: dependent,
        dependencies: { [dependency]: "*" },
        scripts: { script: `cat ../${dependency}/out.txt` },
      }),
    },
  });

  test.each([
    ["dep0", "dep1"],
    // A name longer than 8 bytes is not stored inline in the dependency map (#12203).
    ["larger-than-8-char", "main"],
  ])("respect dependency order (%s before %s)", async (dependency, dependent) => {
    using dir = tempDir("testworkspace", dependencyOrder(dependency, dependent));
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "script"]);
    expect(sorted(stdout)).toEqual(finished("script", { [dependency]: [], [dependent]: "success" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // dep0 and dep1 depend on each other. The runner drops the dependency order
  // for the whole run (both scripts are alive at the same time) but still
  // runs dep0's pre and post scripts around its main script.
  test("ignore dependency order on cycle, preserving pre and post script order", async () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "rendezvous.js": rendezvous,
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            prescript: "echo success > out.txt",
            script: `cat out.txt && ${bunExe()} rendezvous.js dep0 dep1 && echo great success > post.txt`,
            postscript: "cat post.txt",
          },
          dependencies: { dep1: "*" },
        }),
      },
      dep1: {
        "rendezvous.js": rendezvous,
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: { dep0: "*" },
          scripts: { script: `${bunExe()} rendezvous.js dep1 dep0` },
        }),
      },
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "script"]);
    expect(sorted(stdout)).toEqual(
      [
        ...finished("prescript", { dep0: [] }),
        ...finished("script", { dep0: ["success", "dep0 saw dep1"], dep1: "dep1 saw dep0" }),
        ...finished("postscript", { dep0: "great success" }),
      ].sort(),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("detect cycle of length > 2", async () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "package.json": JSON.stringify({ name: "dep0", dependencies: { dep1: "*" }, scripts: { script: "echo dep0" } }),
      },
      dep1: {
        "package.json": JSON.stringify({ name: "dep1", dependencies: { dep2: "*" }, scripts: { script: "echo dep1" } }),
      },
      dep2: {
        "package.json": JSON.stringify({ name: "dep2", dependencies: { dep0: "*" }, scripts: { script: "echo dep2" } }),
      },
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "script"]);
    expect(sorted(stdout)).toEqual(finished("script", { dep0: "dep0", dep1: "dep1", dep2: "dep2" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.each(["notpresent", "x"])("errors when no package has the script (%s)", async script => {
    const { stdout, stderr, exitCode } = await run(cwd_root, ["run", "--filter", "*", script]);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(
      `${malformedWarning}\nerror: No workspace packages matched the filter "*"`,
    );
    expect(exitCode).toBe(1);
  });

  test("warns about a filter that matched nothing while running the others", async () => {
    const { stdout, stderr, exitCode } = await run(cwd_root, [
      "run",
      "--filter",
      "pkga",
      "--filter",
      "typo",
      "present",
    ]);
    expect(sorted(stdout)).toEqual(finished("present", { pkga: "scripta" }));
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(
      `${malformedWarning}\nwarn: No workspace packages matched the filter "typo"`,
    );
    expect(exitCode).toBe(0);
  });

  test("nonzero exit code on failure", async () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "package.json": JSON.stringify({ name: "dep0", scripts: { script: "exit 0" } }),
      },
      dep1: {
        "package.json": JSON.stringify({ name: "dep1", scripts: { script: "exit 23" } }),
      },
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "script"]);
    expect(sorted(stdout)).toEqual([...finished("script", { dep0: [] }), ...finished("script", { dep1: [] }, 23)]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(23);
  });

  function elideWorkspace(prefix: string) {
    return tempDir(prefix, {
      packages: {
        dep0: {
          "package.json": JSON.stringify({ name: "dep0", scripts: { script: twentyLines } }),
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });
  }

  // FORCE_COLOR turns the terminal renderer on for a pipe on POSIX. On
  // Windows the renderer needs a real console, so a pipe gets the plain
  // line-per-line output and --elide-lines has nothing to act on.
  test.each([
    ["elides all but the last 10 lines by default", [], 10],
    ["respects --elide-lines", ["--elide-lines", "15"], 5],
    ["--elide-lines=0 shows all output", ["--elide-lines", "0"], 0],
  ])("%s", async (_, flags, elided) => {
    using dir = elideWorkspace("filter-elide");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      ["run", ...flags, "--filter", "./packages/dep0", "script"],
      {
        FORCE_COLOR: "1",
        NO_COLOR: "0",
      },
    );
    if (isWindows) {
      expect(sorted(stdout)).toEqual(finished("script", { dep0: range(1, 20) }));
    } else {
      expect(lastFrame(stdout)).toBe(
        [
          `dep0 script $ ${twentyLines}`,
          ...(elided > 0 ? [`│ [${elided} lines elided]`] : []),
          ...range(elided + 1, 20).map(line => `│ ${line}`),
          "└─ Done in <time>",
        ].join("\n"),
      );
    }
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--elide-lines is a no-op (not an error) when stdout is not a terminal", async () => {
    using dir = elideWorkspace("filter-elide-pipe");
    // A value other than the default: if elision leaked into the plain
    // output, only 5 lines would survive.
    const { stdout, stderr, exitCode } = await run(String(dir), [
      "run",
      "--filter",
      "./packages/dep0",
      "--elide-lines",
      "5",
      "script",
    ]);
    expect(sorted(stdout)).toEqual(finished("script", { dep0: range(1, 20) }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // The terminal renderer is TTY-only on Windows (see the elision tests).
  test.skipIf(isWindows)("terminal output reports how long a successful script took", async () => {
    using dir = tempDir("filter-done-in", {
      packages: {
        dep0: {
          "package.json": JSON.stringify({ name: "dep0", scripts: { script: "exit 0" } }),
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "dep0", "script"], {
      FORCE_COLOR: "1",
      NO_COLOR: "0",
    });
    expect(lastFrame(stdout)).toBe(["dep0 script $ exit 0", "└─ Done in <time>"].join("\n"));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("self-referential directory symlink in a workspace does not loop", async () => {
    using dir = tempDir("filter-symlink-loop", {
      packages: {
        pkga: {
          "package.json": JSON.stringify({ name: "pkga", scripts: { present: "echo scripta" } }),
        },
        cyc: {
          "package.json": JSON.stringify({ name: "cyc", scripts: { present: "echo scriptcyc" } }),
        },
      },
      // `packages/**` makes workspace discovery recurse into every package.
      "package.json": JSON.stringify({
        name: "ws",
        scripts: { present: "echo rootscript" },
        workspaces: ["packages/**"],
      }),
    });
    // "junction" so the link is creatable on unprivileged Windows; the type is
    // ignored on POSIX.
    symlinkSync(join(dir, "packages", "cyc"), join(dir, "packages", "cyc", "loop"), "junction");

    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "present"]);
    // `pkga` is matched once. `cyc` is matched at `packages/cyc` and once more
    // through its own `loop` alias, where the cycle is detected and descent
    // stops instead of recursing until the path length limit.
    expect(sorted(stdout)).toEqual(
      [
        ...finished("present", { pkga: "scripta", cyc: "scriptcyc" }),
        ...finished("present", { cyc: "scriptcyc" }),
      ].sort(),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("warning names which package.json failed to parse", async () => {
    using dir = tempDir("filter-bad-pkgjson", {
      packages: {
        good: {
          "package.json": JSON.stringify({ name: "good", scripts: { go: "echo ok" } }),
        },
        broken: {
          "package.json": "this is { not valid json",
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "*", "go"]);
    // The good package still runs; the broken one is skipped with a warning
    // that names its path.
    expect(sorted(stdout)).toEqual(finished("go", { good: "ok" }));
    expect(normalizeBunSnapshot(stderr, String(dir))).toBe(
      `warn: Failed to read "<dir>/packages/broken/package.json", skipping this workspace package`,
    );
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("selectors", () => {
  const out = (...names: string[]) => Object.fromEntries(names.map(name => [name, `out-${name}`]));

  // `bun run --filter` only runs workspace members; the root's own scripts
  // are never selected.
  test.each([
    ["'foo...' runs foo and the workspaces it depends on", ["api..."], out("api", "pkg-a")],
    ["'foo^...' runs only the dependencies", ["api^..."], out("pkg-a")],
    ["'...foo' runs foo and its dependents", ["...api"], out("api", "web")],
    ["'...^foo' runs only the dependents", ["...^api"], out("web")],
    ["a relation on a directory selector", ["...{./packages/pkg-a}"], out("pkg-a", "api", "web")],
    [
      "'{dir}' runs everything under the directory but not the root",
      ["{packages}"],
      out("api", "web", "pkg-a", "pkg-b"),
    ],
    ["a '!' pattern subtracts from '*'", ["*", "!web"], out("api", "pkg-a", "pkg-b")],
    ["a negation-only filter starts from every workspace", ["!web"], out("api", "pkg-a", "pkg-b")],
    ["several negation-only filters all subtract", ["!web", "!pkg-b"], out("api", "pkg-a")],
    ["a negated path pattern subtracts from '*'", ["*", "!./packages/web"], out("api", "pkg-a", "pkg-b")],
    [
      "a negated '{dir}' pattern on its own subtracts from every workspace",
      ["!{./packages/web}"],
      out("api", "pkg-a", "pkg-b"),
    ],
    ["a negated relation subtracts the whole group", ["*", "!...api"], out("pkg-a", "pkg-b")],
  ])("%s", async (_, patterns, expected) => {
    const filters = patterns.flatMap(pattern => ["--filter", pattern]);
    const { stdout, stderr, exitCode } = await run(graph_root, ["run", ...filters, "present"]);
    expect(sorted(stdout)).toEqual(finished("present", expected));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("'{.}' is resolved from the current directory", async () => {
    const { stdout, stderr, exitCode } = await run(join(graph_root, "packages"), ["run", "--filter", "{.}", "present"]);
    expect(sorted(stdout)).toEqual(finished("present", out("api", "web", "pkg-a", "pkg-b")));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a negation-only filter set still skips a package.json without a name", async () => {
    const { stdout, stderr, exitCode } = await run(cwd_root, ["run", "--filter", "!pkga", "present"]);
    expect(sorted(stdout)).toEqual(
      finished("present", { pkgb: "scriptb", pkgc: "scriptc", "@scoped/scoped": "scriptd" }),
    );
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
    expect(exitCode).toBe(0);
  });

  test("'*' still skips a package.json without a name", async () => {
    const { stdout, stderr, exitCode } = await run(cwd_root, ["run", "--filter", "*", "present"]);
    expect(sorted(stdout)).toEqual(
      finished("present", { pkga: "scripta", pkgb: "scriptb", pkgc: "scriptc", "@scoped/scoped": "scriptd" }),
    );
    expect(normalizeBunSnapshot(stderr, cwd_root)).toBe(malformedWarning);
    expect(exitCode).toBe(0);
  });

  test("'foo...' follows optionalDependencies but not peerDependencies", async () => {
    using dir = tempDir("filter-optional-peer", {
      packages: {
        app: {
          "package.json": JSON.stringify({
            name: "app",
            optionalDependencies: { optlib: "workspace:*" },
            peerDependencies: { peerlib: "workspace:*" },
            scripts: { present: "echo out-app" },
          }),
        },
        optlib: {
          "package.json": JSON.stringify({ name: "optlib", scripts: { present: "echo out-optlib" } }),
        },
        peerlib: {
          "package.json": JSON.stringify({ name: "peerlib", scripts: { present: "echo out-peerlib" } }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
        scripts: { present: "echo out-root" },
      }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "app...", "present"]);
    expect(sorted(stdout)).toEqual(finished("present", out("app", "optlib")));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("selectors work in the 'bun --filter <script>' form", async () => {
    const { stdout, stderr, exitCode } = await run(graph_root, ["--filter", "api...", "present"]);
    expect(sorted(stdout)).toEqual(finished("present", out("api", "pkg-a")));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // `--parallel` has its own renderer: "<package>:<script> | " prefixes padded
  // to the longest label, output on stdout and the status lines on stderr.
  test("selectors work with --parallel", async () => {
    const { stdout, stderr, exitCode } = await run(graph_root, ["run", "--parallel", "--filter", "api...", "present"]);
    expect(sorted(stdout)).toEqual(["api:present   | out-api", "pkg-a:present | out-pkg-a"]);
    expect(sorted(stderr.replace(/Done in \d+(?:\.\d+)?m?s/g, "Done in <time>"))).toEqual([
      "api:present   | Done in <time>",
      "pkg-a:present | Done in <time>",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a bare '...' is rejected", async () => {
    const { stdout, stderr, exitCode } = await run(graph_root, ["run", "--filter", "...", "present"]);
    expect(stdout).toBe("");
    expect(stderr).toBe('error: --filter "..." is missing a workspace name or path\n');
    expect(exitCode).toBe(1);
  });

  // Same asymmetry as "respect dependency order": dep0 needs a runtime start
  // before it writes, dep1 only needs `cat`.
  test("dependency order is kept inside a relation selection", async () => {
    using dir = tempDir("filter-selectors-order", {
      dep0: {
        "write.js": writeSuccess,
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: { script: `${bunExe()} write.js` },
        }),
      },
      dep1: {
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: { dep0: "*" },
          scripts: { script: "cat ../dep0/out.txt" },
        }),
      },
      dep2: {
        "package.json": JSON.stringify({ name: "dep2", scripts: { script: "echo unrelated" } }),
      },
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "dep1...", "script"]);
    expect(sorted(stdout)).toEqual(finished("script", { dep0: [], dep1: "success" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// #20319: on Windows, `bun --filter` / `bun run --parallel` spawn each script
// as `bun exec "<script>"` with CREATE_NO_WINDOW, so the user's Ctrl+C never
// reaches the scripts and cleanup is entirely on the parent. libuv's global
// spawn Job is KILL_ON_CLOSE | SILENT_BREAKAWAY_OK, so membership only
// propagates one hop: as soon as the tree contains a non-libuv spawner
// (cmd.exe, a `.cmd` bin shim, node.exe), everything below it escapes and keeps
// its port bound after the parent exits.
//
// Tree under test:
//   test → bun parent → `bun exec` → cmd.exe → leaf bun (long-running).
// The leaf writes its pid to a file; the test kills the parent and polls the
// leaf. Without a recursive kill-on-close Job on the parent, the leaf survives.
describe.skipIf(!isWindows).each([
  { via: "--filter", argv: ["--filter", "*", "dev"] },
  { via: "run --parallel", argv: ["run", "--parallel", "dev"] },
])("windows: $via reaps the whole descendant tree when the parent exits (#20319)", ({ argv }) => {
  test.concurrent(
    "leaf dies",
    async () => {
      function isAlive(pid: number): boolean {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }
      async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (!isAlive(pid)) return true;
          await sleep(25);
        }
        return !isAlive(pid);
      }

      using dir = tempDir("filter-win-cleanup", {
        "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
        // .bat avoids cmd /c's quote-stripping around a quoted exe path + arg.
        "packages/app/run.bat": `@"${bunExe()}" "%~dp0server.js"\r\n`,
        "packages/app/server.js": `
          require("fs").writeFileSync(process.env.PIDFILE, String(process.pid));
          setInterval(() => {}, 1000);
        `,
        "packages/app/package.json": JSON.stringify({
          name: "app",
          scripts: { dev: "cmd /d /c run.bat" },
        }),
      });

      const pidfile = join(String(dir), "leaf.pid");
      // Unset NO_ORPHANS so the test exercises the unconditional Job rather
      // than the opt-in env-var path CI may set globally.
      const env: Record<string, string | undefined> = {
        ...bunEnv,
        PIDFILE: pidfile,
        BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
        NO_COLOR: "1",
      };

      const parent = Bun.spawn({
        cmd: [bunExe(), ...argv],
        env,
        cwd: join(String(dir), "packages", "app"),
        stdout: "ignore",
        stderr: "pipe",
      });

      let leafPid = 0;
      try {
        const deadline = Date.now() + 15000;
        while (leafPid === 0 && Date.now() < deadline) {
          try {
            const t = await Bun.file(pidfile).text();
            if (t.length > 0) leafPid = Number(t.trim());
          } catch {}
          if (leafPid === 0) await sleep(25);
        }
        if (leafPid === 0) {
          parent.kill("SIGKILL");
          await parent.exited;
          const stderr = await parent.stderr.text();
          throw new Error(`leaf never wrote pidfile; stderr:\n${stderr}`);
        }
        expect(isAlive(leafPid)).toBe(true);

        // TerminateProcess on the parent — same effect as the second Ctrl+C
        // (default handler) or the first Ctrl+C's abort() path once the direct
        // children have exited and the parent calls Global::exit().
        parent.kill("SIGKILL");
        await parent.exited;

        const died = await waitUntilDead(leafPid, 10000);
        expect(died).toBe(true);
      } finally {
        parent.kill("SIGKILL");
        await parent.exited;
        if (leafPid > 0 && isAlive(leafPid)) {
          try {
            process.kill(leafPid, "SIGKILL");
          } catch {}
          await waitUntilDead(leafPid, 2000);
        }
      }
    },
    30000,
  );
});

describe.concurrent("output timing", () => {
  // A script is finished when its process exits: output it already wrote is
  // drained at that point, but a detached child still holding the pipe write
  // ends must not keep the run alive waiting for an EOF that may never come.
  test("a detached child holding the pipes does not delay the script's finish", async () => {
    using dir = tempDir("filter-late-output", {
      "package.json": JSON.stringify({
        name: "ws-late",
        workspaces: ["packages/*"],
      }),
      "packages/late/package.json": JSON.stringify({
        name: "pkg-late",
        scripts: {
          go: `${bunExe()} late.js`,
        },
      }),
      "packages/late/late.js": `
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "await Bun.sleep(30_000); console.log('late-line')"],
          stdio: ["ignore", "inherit", "inherit"],
          // Windows: keep the child out of this process's kill-on-close job.
          detached: true,
        });
        child.unref();
        await Bun.write("pid.txt", String(child.pid));
        console.log("early-line");
      `,
    });
    // CI ASAN lanes set BUN_FEATURE_FLAG_NO_ORPHANS, which makes the script's
    // bun SIGKILL the detached child on exit; unset it so the child really
    // keeps the pipes open.
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "pkg-late", "go"], {
      BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
    });
    // Reap the pipe-holding child so nothing outlives the test. Guard the pid:
    // kill(0) would signal this whole process group.
    try {
      const pid = Number(await Bun.file(join(String(dir), "packages", "late", "pid.txt")).text());
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
    } catch {}
    // The run ends when the script exits; the child's much later write goes to
    // a closed pipe instead of delaying the run by 30s.
    expect(sorted(stdout)).toEqual(finished("go", { "pkg-late": "early-line" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // On abort (here: SIGINT), exit alone finishes a script; waiting for pipe
  // EOF would hang on the detached child that still holds go's stdout.
  test.skipIf(isWindows)("SIGINT does not wait for a child holding the script's pipes", async () => {
    using dir = tempDir("filter-abort-late", {
      "package.json": JSON.stringify({
        name: "ws-abort",
        workspaces: ["packages/*"],
      }),
      "packages/bg/package.json": JSON.stringify({
        name: "pkg-bg",
        scripts: {
          go: `${bunExe()} go.js`,
        },
      }),
      "packages/bg/go.js": `
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "await Bun.sleep(30_000)"],
          stdio: ["ignore", "inherit", "inherit"],
          detached: true,
        });
        child.unref();
        await Bun.write("ready.txt", String(child.pid));
        await Bun.sleep(15_000);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--filter", "pkg-bg", "go"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // New session, so the group signal below cannot reach the test runner.
      detached: true,
    });
    const ready = join(String(dir), "packages", "bg", "ready.txt");
    const deadline = Date.now() + 15_000;
    while (!existsSync(ready)) {
      if (Date.now() > deadline || proc.exitCode !== null) {
        proc.kill();
        const [o, e] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
        throw new Error(`go never wrote ready.txt; stdout: ${o}stderr: ${e}`);
      }
      await Bun.sleep(10);
    }
    // Ctrl-C semantics: the terminal signals the foreground process group
    // (bun run and the script), but not the detached grandchild.
    const start = Date.now();
    process.kill(-proc.pid, "SIGINT");
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Reap the pipe-holding grandchild so nothing outlives the test. Guard the
    // pid: kill(0) would signal this whole process group.
    try {
      const pid = Number(await Bun.file(ready).text());
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
    } catch {}
    // go is killed by the signal and is the only script, so the run exits
    // with 128 + SIGINT.
    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 130,
      stdout: "pkg-bg go: Signaled with code SIGINT\n",
      stderr: "",
    });
    // Waiting out the grandchild's 30s sleep means the abort bypass regressed.
    expect(Date.now() - start).toBeLessThan(15000);
  });
});

describe("auto-discovered bunfig.toml [run] section", () => {
  // With `run.bun = true` bun puts a `node` shim on PATH, so `typeof Bun`
  // tells which binary ran the script. Every bun process on the machine
  // shares that shim directory and a debug build deletes it before it writes
  // the shim again, so the tests that need it stay serial.
  const typeofBun = `node -e "console.log('Bun is ' + typeof Bun)"`;

  function workspace(prefix: string, bunfig: string) {
    return tempDir(prefix, {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      packages: {
        dep0: {
          "package.json": JSON.stringify({
            name: "dep0",
            scripts: { script: typeofBun, lines: twentyLines },
          }),
        },
      },
    });
  }

  test.each([
    ["bun run --filter", ["run", "--filter", "dep0", "script"]],
    ["bun --filter", ["--filter", "dep0", "script"]],
    ["bun run --workspaces", ["run", "--workspaces", "script"]],
  ])("%s applies [run] bun = true", async (_, args) => {
    using dir = workspace("filter-bunfig-run-bun", "[run]\nbun = true\n");
    const { stdout, stderr, exitCode } = await run(String(dir), args);
    expect(sorted(stdout)).toEqual(finished("script", { dep0: "Bun is object" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--bun on the CLI wins over [run] bun = false", async () => {
    using dir = workspace("filter-bunfig-cli-bun", "[run]\nbun = false\n");
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--bun", "--filter", "dep0", "script"]);
    expect(sorted(stdout)).toEqual(finished("script", { dep0: "Bun is object" }));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Elision only happens on a terminal. On POSIX FORCE_COLOR=1 turns the
  // terminal renderer on for a pipe; on Windows it stays off (see the elision tests).
  test.concurrent.skipIf(isWindows)("[run] elide-lines = 0 disables elision for --filter", async () => {
    using dir = workspace("filter-bunfig-elide", "[run]\nelide-lines = 0\n");
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "dep0", "lines"], {
      FORCE_COLOR: "1",
      NO_COLOR: "0",
    });
    expect(lastFrame(stdout)).toBe(
      [`dep0 lines $ ${twentyLines}`, ...range(1, 20).map(line => `│ ${line}`), "└─ Done in <time>"].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(isWindows)("--elide-lines on the CLI wins over [run] elide-lines", async () => {
    using dir = workspace("filter-bunfig-cli-elide", "[run]\nelide-lines = 0\n");
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      ["run", "--elide-lines", "15", "--filter", "dep0", "lines"],
      { FORCE_COLOR: "1", NO_COLOR: "0" },
    );
    expect(lastFrame(stdout)).toBe(
      [
        `dep0 lines $ ${twentyLines}`,
        "│ [5 lines elided]",
        ...range(6, 20).map(line => `│ ${line}`),
        "└─ Done in <time>",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a malformed bunfig.toml fails the run", async () => {
    using dir = workspace("filter-bunfig-malformed", '[run]\nbun = "yes"\n');
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--filter", "dep0", "script"]);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "2 | bun = "yes"
                ^
      error: Expected boolean
          at <dir>/bunfig.toml:2:7

      Invalid Bunfig: failed to load bunfig"
    `);
    expect(exitCode).toBe(1);
  });
});
