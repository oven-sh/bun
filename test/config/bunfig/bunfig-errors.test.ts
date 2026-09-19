import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

describe.concurrent("bunfig.toml type-mismatch error messages", () => {
  const cases: [config: string, expected: string][] = [
    [`smol = "yes"`, "expected boolean but received string"],
    [`logLevel = 3`, "expected string but received number"],
    [`telemetry = "no"`, "expected boolean but received string"],
    [`define = 3`, "expected object but received number"],
    [`[serve]\nport = "abc"`, "expected number but received string"],
  ];

  test.each(cases)("%s -> %s", async (config, expected) => {
    using dir = tempDir("bunfig-type-mismatch", {
      "bunfig.toml": config + "\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "1"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const errorLine = stderr.split("\n").find(l => l.startsWith("error:")) ?? stderr;
    expect(errorLine).toBe(`error: ${expected}`);
    expect(stderr).not.toMatch(/\be_(string|boolean|number|object|array|null)\b/);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
});

// bun builds every config path in a stack buffer of MAX_PATH_BYTES (the platform's
// PATH_MAX, see bun_core), so the longest path it can hold is MAX_PATH_BYTES - 1
// bytes plus the NUL terminator. Paths that do not fit used to overflow the buffer
// (a panic at startup); they must be treated like any other unreadable config.
//
// On Windows the buffer is ~96 KiB, longer than any path, argument or environment
// variable the OS accepts, so the overflow cannot be reached there.
describe.concurrent.skipIf(isWindows)("config paths that do not fit in a path buffer", () => {
  const MAX_PATH_BYTES = process.platform === "linux" || process.platform === "android" ? 4096 : 1024;
  // A TOML syntax error: every command fails to load it, and the error names the
  // path the config was loaded from.
  const INVALID_BUNFIG = "[install\n";
  const SEGMENT = Buffer.alloc(200, "d").toString();

  /** An absolute path below `root` whose UTF-8 encoding is exactly `length` bytes long. */
  function pathOfLength(root: string, length: number): string {
    let path = root;
    // Leave room for the final component, which has to stay under NAME_MAX (255).
    while (length - Buffer.byteLength(path) > 256) path = join(path, SEGMENT);
    path = join(path, Buffer.alloc(length - Buffer.byteLength(path) - 1, "L").toString());
    expect(Buffer.byteLength(path)).toBe(length);
    return path;
  }

  /** Writes an invalid config at `configPath` and returns it. */
  function invalidConfigAt(configPath: string): string {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, INVALID_BUNFIG);
    return configPath;
  }

  async function runBun(args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  type Result = Awaited<ReturnType<typeof runBun>>;

  function expectLoadedFrom({ stdout, stderr, exitCode }: Result, configPath: string) {
    expect(stderr).toContain(`at ${configPath}:`);
    expect(stderr).toContain("failed to load bunfig");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }

  function expectNameTooLong({ stdout, stderr, exitCode }: Result, configArg: string) {
    expect(stderr.replaceAll(configArg, "<config>")).toBe(
      'ENAMETOOLONG: <config>: File name too long (open())\nwhile reading config "<config>"\n',
    );
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }

  describe("bunfig.toml auto-loaded from the working directory", () => {
    const PRINT_CWD_BYTES = "console.log(Buffer.byteLength(process.cwd()))";

    test("is loaded when its path is exactly MAX_PATH_BYTES - 1 bytes", async () => {
      using dir = tempDir("bunfig-long-cwd", {});
      const cwd = pathOfLength(String(dir), MAX_PATH_BYTES - "/bunfig.toml".length - 1);
      const config = invalidConfigAt(join(cwd, "bunfig.toml"));
      expect(Buffer.byteLength(config)).toBe(MAX_PATH_BYTES - 1);

      expectLoadedFrom(await runBun(["-e", PRINT_CWD_BYTES], cwd), config);
    });

    // No bunfig.toml exists in these directories: its path would be too long to
    // create, and the path is built (and used to overflow) before it is opened.
    const skippedCases: [configPathWouldBe: string, cwdBytes: number][] = [
      ["exactly MAX_PATH_BYTES bytes, leaving no room for the NUL", MAX_PATH_BYTES - "/bunfig.toml".length],
      ["longer than the buffer", MAX_PATH_BYTES - 1],
    ];

    test.each(skippedCases)("bun -e still runs when the bunfig.toml path would be %s", async (_, cwdBytes) => {
      using dir = tempDir("bunfig-long-cwd", {});
      const cwd = pathOfLength(String(dir), cwdBytes);
      mkdirSync(cwd, { recursive: true });

      expect(await runBun(["-e", PRINT_CWD_BYTES], cwd)).toEqual({
        stdout: `${cwdBytes}\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test("bun <file> still runs when the bunfig.toml path does not fit", async () => {
      using dir = tempDir("bunfig-long-cwd", {});
      const cwdBytes = MAX_PATH_BYTES - "/bunfig.toml".length;
      const cwd = pathOfLength(String(dir), cwdBytes);
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cwd, "x.cjs"), PRINT_CWD_BYTES);

      expect(await runBun(["x.cjs"], cwd)).toEqual({
        stdout: `${cwdBytes}\n`,
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("--config=<relative path>", () => {
    test("is loaded when the resolved path is exactly MAX_PATH_BYTES - 1 bytes", async () => {
      using dir = tempDir("bunfig-long-config", {});
      const config = invalidConfigAt(pathOfLength(String(dir), MAX_PATH_BYTES - 1));

      expectLoadedFrom(await runBun([`--config=${relative(String(dir), config)}`, "-e", "1"], String(dir)), config);
    });

    test("fails with ENAMETOOLONG when the resolved path is MAX_PATH_BYTES bytes", async () => {
      using dir = tempDir("bunfig-long-config", {});
      const configArg = relative(String(dir), pathOfLength(String(dir), MAX_PATH_BYTES));

      expectNameTooLong(await runBun([`--config=${configArg}`, "-e", "1"], String(dir)), configArg);
    });

    test("fails with ENAMETOOLONG when the argument alone is longer than the buffer", async () => {
      using dir = tempDir("bunfig-long-config", {});
      const configArg = Buffer.alloc(MAX_PATH_BYTES + 1000, "a").toString();

      expectNameTooLong(await runBun([`--config=${configArg}`, "-e", "1"], String(dir)), configArg);
    });

    test("is loaded when a path longer than the buffer normalizes to one that fits", async () => {
      using dir = tempDir("bunfig-long-config", { "bunfig.toml": INVALID_BUNFIG });
      const hop = "x/../";
      const hops = Buffer.alloc(Math.ceil(MAX_PATH_BYTES / hop.length) * hop.length, hop).toString();
      const configArg = hops + "bunfig.toml";
      expect(configArg.length).toBeGreaterThan(MAX_PATH_BYTES);

      expectLoadedFrom(
        await runBun([`--config=${configArg}`, "-e", "1"], String(dir)),
        join(String(dir), "bunfig.toml"),
      );
    });
  });

  describe("--config=<absolute path>", () => {
    test("is loaded when the path is exactly MAX_PATH_BYTES - 1 bytes", async () => {
      using dir = tempDir("bunfig-long-config", {});
      const config = invalidConfigAt(pathOfLength(String(dir), MAX_PATH_BYTES - 1));

      expectLoadedFrom(await runBun([`--config=${config}`, "-e", "1"], String(dir)), config);
    });

    const tooLongCases: [pathIs: string, configArgBelow: (root: string) => string][] = [
      ["exactly MAX_PATH_BYTES bytes", root => pathOfLength(root, MAX_PATH_BYTES)],
      ["longer than the buffer", () => "/" + Buffer.alloc(MAX_PATH_BYTES + 1000, "a").toString()],
    ];

    test.each(tooLongCases)("fails with ENAMETOOLONG when the path is %s", async (_, configArgBelow) => {
      using dir = tempDir("bunfig-long-config", {});
      const configArg = configArgBelow(String(dir));

      expectNameTooLong(await runBun([`--config=${configArg}`, "-e", "1"], String(dir)), configArg);
    });
  });

  // Install commands also read $XDG_CONFIG_HOME/.bunfig.toml (or $HOME/.bunfig.toml).
  // `bun pm cache` prints the cache directory once that config has been handled.
  describe("global .bunfig.toml", () => {
    const PACKAGE_JSON = { "package.json": JSON.stringify({ name: "bunfig-global-test" }) };
    // `bun pm cache` creates the directory it prints, and silently falls back to
    // node_modules/.cache when it cannot, so it has to live inside the temp dir.
    const cacheDirIn = (dir: string) => join(dir, "install-cache");
    async function pmCache(dir: string, env: Record<string, string | undefined>): Promise<Result> {
      const result = await runBun(["pm", "cache"], dir, { BUN_INSTALL_CACHE_DIR: cacheDirIn(dir), ...env });
      return { ...result, stdout: result.stdout.trim() };
    }
    /** The global config was skipped and the command went on to print the cache directory. */
    const printedCacheDir = (dir: string): Result => ({ stdout: cacheDirIn(dir), stderr: "", exitCode: 0 });

    test("is loaded when its path is exactly MAX_PATH_BYTES - 1 bytes", async () => {
      using dir = tempDir("bunfig-long-global", PACKAGE_JSON);
      const configHome = pathOfLength(String(dir), MAX_PATH_BYTES - "/.bunfig.toml".length - 1);
      const config = invalidConfigAt(join(configHome, ".bunfig.toml"));
      expect(Buffer.byteLength(config)).toBe(MAX_PATH_BYTES - 1);

      expectLoadedFrom(await pmCache(String(dir), { XDG_CONFIG_HOME: configHome }), config);
    });

    // The directories never exist; only the length of the variable matters. The
    // longest value used here still leaves room for the "/.npmrc" that install
    // commands append to the same variables afterwards.
    const skippedCases: [configPathWouldBe: string, configHomeLength: number][] = [
      ["exactly MAX_PATH_BYTES bytes, leaving no room for the NUL", MAX_PATH_BYTES - "/.bunfig.toml".length],
      ["longer than the buffer", MAX_PATH_BYTES - "/.npmrc".length - 1],
    ];

    test.each(skippedCases)("is skipped when its $XDG_CONFIG_HOME path would be %s", async (_, configHomeLength) => {
      using dir = tempDir("bunfig-long-global", PACKAGE_JSON);
      const configHome = pathOfLength(String(dir), configHomeLength);

      expect(await pmCache(String(dir), { XDG_CONFIG_HOME: configHome })).toEqual(printedCacheDir(String(dir)));
    });

    test("is skipped when its $HOME path would be exactly MAX_PATH_BYTES bytes", async () => {
      using dir = tempDir("bunfig-long-global", PACKAGE_JSON);
      const home = pathOfLength(String(dir), MAX_PATH_BYTES - "/.bunfig.toml".length);

      expect(await pmCache(String(dir), { HOME: home, XDG_CONFIG_HOME: undefined })).toEqual(
        printedCacheDir(String(dir)),
      );
    });
  });
});
