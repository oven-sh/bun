import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `-c` / `--config` must bind its path argument in every spelling.
// https://github.com/oven-sh/bun/issues/6300, https://github.com/oven-sh/bun/issues/21431

async function run(cwd: string, argv: string[], env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const spellings = [
  ["--config=cfg.toml"],
  ["--config", "cfg.toml"],
  ["-c=cfg.toml"],
  ["-c", "cfg.toml"],
  ["-ccfg.toml"],
];

describe.concurrent("bun install --config path binding", () => {
  test.each(spellings)("install %p loads the named config, never treats it as a package", async (...flag) => {
    // Local 404 registry so nothing ever reaches the public network, even if
    // parsing regresses and routes the path to `bun add`.
    const hits: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        hits.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    const base = `http://localhost:${server.port}`;

    using dir = tempDir("config-flag-install", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      // Auto-loaded when `--config` is NOT effective (regression).
      "bunfig.toml": `[install]\nregistry = "${base}/default/"\ncache = false\n`,
      // Loaded when `--config cfg.toml` IS effective (the fix).
      "cfg.toml": `[install]\nregistry = "${base}/fromcfg/"\ncache = false\n`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), ["install", ...flag]);
    const out = stdout + stderr;

    // The path must never be routed to `bun add` as a package name.
    expect(out).not.toContain("bun add");
    expect(hits).not.toContain("/default/cfg.toml");
    // The named config must have been loaded, not the auto-loaded bunfig.toml.
    expect(hits).toContain("/fromcfg/no-deps");
    expect(hits).not.toContain("/default/no-deps");
    expect(exitCode).not.toBe(0);
  });
});

describe.concurrent("bare -c / --config requires a value", () => {
  test.each([[["install", "--config"]], [["install", "-c"]], [["--config"]], [["-c"]]])(
    "bun %p errors instead of silently defaulting",
    async argv => {
      using dir = tempDir("config-flag-bare", {
        "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      });
      const { stderr, exitCode } = await run(String(dir), argv);
      expect(stderr).toContain(argv.at(-1)!);
      expect(stderr.toLowerCase()).toContain("requires a value");
      expect(exitCode).not.toBe(0);
    },
  );
});

// The subcommand keyword is picked before flag values are parsed, so only the
// single-token spellings can precede `run`; the space forms go after it.
const scriptArgv = [
  ...spellings,
  ...spellings.map(flag => ["run", ...flag]),
  ...spellings.filter(flag => flag.length === 1).map(flag => [...flag, "run"]),
];

describe.concurrent("bun [run] --config path binding", () => {
  test.each(scriptArgv.map(argv => [argv]))("bun %p app.ts loads the named config and runs app.ts", async argv => {
    using dir = tempDir("config-flag-run", {
      "app.ts": `console.log(JSON.stringify({ fromCfg: process.env.FROM_CFG ?? "no", argv: process.argv.slice(2) }));`,
      "cfg.toml": `[define]\n"process.env.FROM_CFG" = '"yes"'\n`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), [...argv, join(String(dir), "app.ts"), "pass-through"]);
    // The config path must not be treated as the entry point.
    expect(stderr).not.toContain("cfg.toml");
    expect(JSON.parse(stdout.trim())).toEqual({ fromCfg: "yes", argv: ["pass-through"] });
    expect(exitCode).toBe(0);
  });
});

// A path left as a positional (`./ci.toml`, `/abs/ci.toml`) was run as the program:
// bun loaded the toml file, printed nothing and exited 0.
describe.concurrent("-c / --config with a path", () => {
  const ci = `[define]\n"process.env.FROM_CFG" = '"ci"'\n\n[install]\nsaveTextLockfile = false\n`;
  const files = {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      workspaces: ["dep"],
      scripts: { build: "echo built > built.txt" },
      dependencies: { dep: "workspace:*" },
    }),
    "proj/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    "proj/ci.toml": ci,
    "proj/config/ci.toml": ci,
    "proj/main.ts": `console.log("main cfg=" + (process.env.FROM_CFG ?? "none"));`,
    "proj/x.test.ts": `import { test } from "bun:test"; test("t", () => console.log("test cfg=" + (process.env.FROM_CFG ?? "none")));`,
  };

  const flags: [string, (proj: string) => string[]][] = [
    ["--config=./ci.toml", () => ["--config=./ci.toml"]],
    ["--config ci.toml", () => ["--config", "ci.toml"]],
    ["--config ./ci.toml", () => ["--config", "./ci.toml"]],
    ["-c ./ci.toml", () => ["-c", "./ci.toml"]],
    ["-c ../proj/ci.toml", () => ["-c", "../proj/ci.toml"]],
    ["-c <absolute>/ci.toml", proj => ["-c", join(proj, "ci.toml")]],
    ["-c config/ci.toml", () => ["-c", "config/ci.toml"]],
  ];

  // What each command leaves behind when it ran with ci.toml loaded.
  const ran = {
    "main.ts": { printed: ["main cfg=ci"], made: [] },
    "test": { printed: ["test cfg=ci"], made: [] },
    "install": { printed: [], made: ["node_modules/dep", "bun.lockb"] },
    "run build": { printed: [], made: ["built.txt"] },
  };
  type Placement = [command: keyof typeof ran, beforeFlag: string[], afterFlag: string[]];
  const keywordFirst: Placement[] = [
    ["main.ts", [], ["main.ts"]],
    ["test", ["test"], []],
    ["install", ["install"], []],
    ["run build", ["run"], ["build"]],
  ];
  const flagFirst: Placement[] = [
    ["test", [], ["test"]],
    ["install", [], ["install"]],
    ["run build", [], ["run", "build"]],
  ];
  const cases = (spellings: typeof flags, placements: Placement[]) =>
    spellings.flatMap(([spelling, flag]) =>
      placements.map(
        ([command, before, after]) =>
          [
            [...before, spelling, ...after].join(" "),
            ran[command],
            (proj: string) => [...before, ...flag(proj), ...after],
          ] as const,
      ),
    );

  async function check(_title: string, want: (typeof ran)[keyof typeof ran], argv: (proj: string) => string[]) {
    using dir = tempDir("config-flag-path", files);
    const proj = join(String(dir), "proj");
    // A regression that sends the path to `bun add` must stay off the public registry.
    const registryHits: string[] = [];
    await using registry = Bun.serve({
      port: 0,
      fetch(req) {
        registryHits.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });

    const { stdout, exitCode } = await run(proj, argv(proj), { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href });

    expect({
      printed: stdout.split(/\r?\n/).filter(line => line.includes("cfg=")),
      made: ["built.txt", "node_modules/dep", "bun.lock", "bun.lockb"].filter(file => existsSync(join(proj, file))),
      registryHits,
      exitCode,
    }).toEqual({ ...want, registryHits: [], exitCode: 0 });
  }

  test.each(cases(flags, keywordFirst))("bun %s", check);
  test.each(cases(flags.slice(0, 1), flagFirst))("bun %s", check);

  // `Command::which()` picks the command before any flag value is parsed, so a path in its own
  // token in front of a keyword is taken for the command: `Script not found "test"`, and for
  // `run` the usage text with exit 0. `--cwd <dir>` and `--env-file <file>` do the same.
  test.todo.each(cases(flags.slice(1), flagFirst))("bun %s", check);
});
