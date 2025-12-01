import { spawnSync, which } from "bun";
import { describe, expect, it } from "bun:test";
import { familySync } from "detect-libc";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
import { basename, join, resolve } from "path";

const process_sleep = resolve(import.meta.dir, "process-sleep.js");

/**
 * Helper function to run inline fixture code and return stdout and exit code
 */
async function runInlineFixture(script, expectedStdout = null, expectedCode = 0) {
  using dir = tempDir("process-test", {
    "index.js": script,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "index.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  if (expectedStdout !== null) {
    expect(stdout).toBe(expectedStdout);
  }
  expect(exitCode).toBe(expectedCode);

  return { stdout, exitCode };
}

it("process", () => {
  // this property isn't implemented yet but it should at least return a string
  const isNode = !process.isBun;

  if (!isNode && process.platform !== "win32" && process.title !== "bun") throw new Error("process.title is not 'bun'");

  if (process.platform !== "win32" && typeof process.env.USER !== "string")
    throw new Error("process.env is not an object");

  if (process.platform !== "win32" && process.env.USER.length === 0)
    throw new Error("process.env is missing a USER property");

  if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32")
    throw new Error("process.platform is invalid");

  if (isNode) throw new Error("process.isBun is invalid");

  // partially to test it doesn't crash due to various strange types
  process.env.BACON = "yummy";
  if (process.env.BACON !== "yummy") {
    throw new Error("process.env is not writable");
  }

  delete process.env.BACON;
  if (typeof process.env.BACON !== "undefined") {
    throw new Error("process.env is not deletable");
  }

  process.env.BACON = "yummy";
  if (process.env.BACON !== "yummy") {
    throw new Error("process.env is not re-writable");
  }
  if (!JSON.stringify(process.env)) {
    throw new Error("process.env is not serializable");
  }

  if (typeof JSON.parse(JSON.stringify(process.env)).toJSON !== "undefined") {
    throw new Error("process.env should call toJSON to hide its internal state");
  }

  // Make sure it doesn't crash
  expect(Bun.inspect(process).length > 0).toBe(true);

  let cwd = process.cwd();
  process.chdir("../");
  expect(process.cwd()).toEqual(resolve(cwd, "../"));
  process.chdir(cwd);
  expect(cwd).toEqual(process.cwd());
});

it("process.title with UTF-16 characters", () => {
  // Test with various UTF-16 characters
  process.title = "Hello, 世界! 🌍";
  expect(process.title).toBe("Hello, 世界! 🌍");

  // Test with emoji only
  process.title = "🌍🌎🌏";
  expect(process.title).toBe("🌍🌎🌏");

  // Test with mixed ASCII and UTF-16
  process.title = "Test 测试 тест";
  expect(process.title).toBe("Test 测试 тест");

  // Test with emoji and text
  process.title = "Bun 🐰";
  expect(process.title).toBe("Bun 🐰");

  process.title = "bun";
  expect(process.title).toBe("bun");
});

it("process.chdir() on root dir", () => {
  const cwd = process.cwd();
  try {
    let root = "/";
    if (process.platform === "win32") {
      const driveLetter = process.cwd().split(":\\")[0];
      root = `${driveLetter}:\\`;
    }
    process.chdir(root);
    expect(process.cwd()).toBe(root);
    process.chdir(cwd);
    expect(process.cwd()).toBe(cwd);
  } finally {
    process.chdir(cwd);
  }
});

it("process.hrtime()", async () => {
  const start = process.hrtime();
  const end = process.hrtime(start);
  expect(end[0]).toBe(0);

  // Flaky on Ubuntu & Windows.
  await Bun.sleep(16);
  const end2 = process.hrtime();

  expect(end2[1] > start[1]).toBe(true);
});

it("process.hrtime.bigint()", () => {
  const start = process.hrtime.bigint();
  const end = process.hrtime.bigint();
  expect(end > start).toBe(true);
});

it("process.release", () => {
  expect(process.release.name).toBe("node");
  const platform = process.platform == "win32" ? "windows" : process.platform;
  const arch = { arm64: "aarch64", x64: "x64" }[process.arch] || process.arch;
  const abi = familySync() === "musl" ? "-musl" : "";
  const nonbaseline = `https://github.com/oven-sh/bun/releases/download/bun-v${process.versions.bun}/bun-${platform}-${arch}${abi}.zip`;
  const baseline = `https://github.com/oven-sh/bun/releases/download/bun-v${process.versions.bun}/bun-${platform}-${arch}${abi}-baseline.zip`;

  expect(process.release.sourceUrl).toBeOneOf([nonbaseline, baseline]);
});

it("process.env", () => {
  process.env["LOL SMILE UTF16 😂"] = "😂";
  expect(process.env["LOL SMILE UTF16 😂"]).toBe("😂");
  delete process.env["LOL SMILE UTF16 😂"];
  expect(process.env["LOL SMILE UTF16 😂"]).toBe(undefined);

  process.env["LOL SMILE latin1 <abc>"] = "<abc>";
  expect(process.env["LOL SMILE latin1 <abc>"]).toBe("<abc>");
  delete process.env["LOL SMILE latin1 <abc>"];
  expect(process.env["LOL SMILE latin1 <abc>"]).toBe(undefined);
});

it("process.env is spreadable and editable", () => {
  process.env["LOL SMILE UTF16 😂"] = "😂";
  const { "LOL SMILE UTF16 😂": lol, ...rest } = process.env;
  expect(lol).toBe("😂");
  delete process.env["LOL SMILE UTF16 😂"];
  expect(rest).toEqual(process.env);
  const orig = (getter => process.env[getter])("USER");
  expect(process.env).toEqual(process.env);
  eval(`globalThis.process.env.USER = 'bun';`);
  expect(eval(`globalThis.process.env.USER`)).toBe("bun");
  expect(eval(`globalThis.process.env.USER = "${orig}"`)).toBe(String(orig));
});

const MIN_ICU_VERSIONS_BY_PLATFORM_ARCH = {
  "darwin-x64": "70.1",
  "darwin-arm64": "72.1",
  "linux-x64": "72.1",
  "linux-arm64": "72.1",
  "win32-x64": "72.1",
  "win32-arm64": "72.1",
};

it("ICU version does not regress", () => {
  const min = MIN_ICU_VERSIONS_BY_PLATFORM_ARCH[`${process.platform}-${process.arch}`];
  if (!min) {
    throw new Error(`Unknown platform/arch: ${process.platform}-${process.arch}`);
  }
  expect(parseFloat(process.versions.icu, 10) || 0).toBeGreaterThanOrEqual(parseFloat(min, 10));
});

it("process.env.TZ", () => {
  var origTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // the default timezone is Etc/UTC
  if (!("TZ" in process.env)) {
    expect(origTimezone).toBe("Etc/UTC");
  }

  const realOrigTimezone = origTimezone;
  if (origTimezone === "America/Anchorage") {
    origTimezone = "America/New_York";
  }

  const target = "America/Anchorage";
  const tzKey = String("TZ" + " ").substring(0, 2);
  process.env[tzKey] = target;
  expect(process.env[tzKey]).toBe(target);
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(target);
  process.env[tzKey] = origTimezone;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(realOrigTimezone);
});

it("process.version starts with v", () => {
  expect(process.version.startsWith("v")).toBeTruthy();
});

it("process.version is set", () => {
  // This implies you forgot -Dreported_nodejs_version in zig build configuration
  expect(process.version).not.toInclude("0.0.0");
  expect(process.version).not.toInclude("unset");
});

it.todo("process.argv0", () => {
  expect(basename(process.argv0)).toBe(basename(process.argv[0]));
});

it("process.execPath", () => {
  expect(process.execPath).not.toBe(basename(process.argv0));
  expect(which(process.execPath)).not.toBeNull();
});

it("process.uptime()", () => {
  expect(process.uptime()).toBeGreaterThan(0);
  expect(Math.floor(process.uptime())).toBe(Math.floor(performance.now() / 1000));
});

it("process.umask()", () => {
  expect(() => process.umask(265n)).toThrow('The "mask" argument must be of type number. Received type bigint (265n)');
  expect(() => process.umask("string")).toThrow(`The argument 'mask' must be a 32-bit unsigned integer or an octal string. Received 'string'`); // prettier-ignore
  expect(() => process.umask(true)).toThrow('The "mask" argument must be of type number. Received type boolean (true)');
  expect(() => process.umask(false)).toThrow('The "mask" argument must be of type number. Received type boolean (false)'); // prettier-ignore
  expect(() => process.umask(null)).toThrow('The "mask" argument must be of type number. Received null');
  expect(() => process.umask({})).toThrow('The "mask" argument must be of type number. Received an instance of Object');
  expect(() => process.umask([])).toThrow('The "mask" argument must be of type number. Received an instance of Array');
  expect(() => process.umask(() => {})).toThrow('The "mask" argument must be of type number. Received function ');
  expect(() => process.umask(Symbol("symbol"))).toThrow('The "mask" argument must be of type number. Received type symbol (Symbol(symbol))'); // prettier-ignore
  expect(() => process.umask(BigInt(1))).toThrow('The "mask" argument must be of type number. Received type bigint (1n)'); // prettier-ignore

  let rangeErrors = [NaN, -1.4, Infinity, -Infinity, -1, 1.3, 4294967296];
  for (let rangeError of rangeErrors) {
    expect(() => {
      process.umask(rangeError);
    }).toThrow(RangeError);
  }

  const mask = process.platform == "win32" ? 0o600 : 0o777;
  const orig = process.umask(mask);
  if (process.platform == "win32") {
    expect(orig).toBe(0);
  } else {
    expect(orig).toBeGreaterThan(0);
  }
  expect(process.umask()).toBe(mask);
  expect(process.umask(undefined)).toBe(mask);
  expect(process.umask(Number(orig))).toBe(mask);
  expect(process.umask()).toBe(orig);
});

it("process.versions", () => {
  // Expected dependency versions (from CMake-generated header)
  const expectedVersions = {
    boringssl: "29a2cd359458c9384694b75456026e4b57e3e567",
    libarchive: "898dc8319355b7e985f68a9819f182aaed61b53a",
    mimalloc: "4c283af60cdae205df5a872530c77e2a6a307d43",
    picohttpparser: "066d2b1e9ab820703db0837a7255d92d30f0c9f5",
    zlib: "886098f3f339617b4243b286f5ed364b9989e245",
    tinycc: "ab631362d839333660a265d3084d8ff060b96753",
    lolhtml: "8d4c273ded322193d017042d1f48df2766b0f88b",
    ares: "d1722e6e8acaf10eb73fa995798a9cd421d9f85e",
    libdeflate: "dc76454a39e7e83b68c3704b6e3784654f8d5ac5",
    zstd: "794ea1b0afca0f020f4e57b6732332231fb23c70",
    lshpack: "3d0f1fc1d6e66a642e7a98c55deb38aa986eb4b0",
  };

  for (const [name, expectedHash] of Object.entries(expectedVersions)) {
    expect(process.versions).toHaveProperty(name);
    expect(process.versions[name]).toBe(expectedHash);
  }

  expect(process.versions).toHaveProperty("usockets");
  expect(process.versions).toHaveProperty("uwebsockets");
  expect(process.versions.usockets).toBe(process.versions.uwebsockets);
});

it("process.config", () => {
  expect(process.config.variables.clang).toBeNumber();
  expect(process.config.variables.host_arch).toBeDefined();
  expect(process.config.variables.target_arch).toBeDefined();
});

it("process.execArgv", () => {
  expect(process.execArgv instanceof Array).toBe(true);
});

it("process.binding", () => {
  expect(() => process.binding("async_wrap")).toThrow();
  expect(() => process.binding("buffer")).not.toThrow();
  expect(() => process.binding("cares_wrap")).toThrow();
  expect(() => process.binding("config")).not.toThrow();
  expect(() => process.binding("constants")).not.toThrow();
  expect(() => process.binding("contextify")).toThrow();
  expect(() => process.binding("crypto")).toThrow();
  expect(() => process.binding("crypto/x509")).not.toThrow();
  expect(() => process.binding("fs")).not.toThrow();
  expect(() => process.binding("fs_event_wrap")).toThrow();
  expect(() => process.binding("http_parser")).not.toThrow();
  expect(() => process.binding("icu")).toThrow();
  expect(() => process.binding("inspector")).toThrow();
  expect(() => process.binding("js_stream")).toThrow();
  expect(() => process.binding("natives")).not.toThrow();
  expect(() => process.binding("os")).toThrow();
  expect(() => process.binding("pipe_wrap")).toThrow();
  expect(() => process.binding("process_wrap")).toThrow();
  expect(() => process.binding("signal_wrap")).toThrow();
  expect(() => process.binding("spawn_sync")).toThrow();
  expect(() => process.binding("stream_wrap")).toThrow();
  expect(() => process.binding("tcp_wrap")).toThrow();
  expect(() => process.binding("tls_wrap")).toThrow();
  expect(() => process.binding("tty_wrap")).not.toThrow();
  expect(() => process.binding("udp_wrap")).toThrow();
  expect(() => process.binding("url")).toThrow();
  expect(() => process.binding("util")).not.toThrow();
  expect(() => process.binding("uv")).not.toThrow();
  expect(() => process.binding("v8")).toThrow();
  expect(() => process.binding("zlib")).toThrow();

  expect(() => process.binding()).toThrow();
  expect(() => process.binding(10)).toThrow();
  expect(() => process.binding(10n)).toThrow();
  expect(() => process.binding(null)).toThrow();
  expect(() => process.binding(true)).toThrow();
  expect(() => process.binding("")).toThrow();
  expect(() => process.binding(function () {})).toThrow();
  expect(() => process.binding(() => {})).toThrow();
  expect(() => process.binding(Symbol("ab"))).toThrow();
  expect(() => process.binding({})).toThrow();
  expect(() => process.binding(Object.freeze({ __proto__: null }))).toThrow();
});

it("process.argv in testing", () => {
  expect(process.argv).toBeInstanceOf(Array);
  expect(process.argv[0]).toBe(process.execPath);

  // assert we aren't creating a new process.argv each call
  expect(process.argv).toBe(process.argv);
});

describe("process.exitCode", () => {
  it("validates int", () => {
    expect(() => (process.exitCode = "potato")).toThrow(
      `The "code" argument must be of type number. Received type string ('potato')`,
    );
    expect(() => (process.exitCode = 1.2)).toThrow(
      `The value of \"code\" is out of range. It must be an integer. Received 1.2`,
    );
    expect(() => (process.exitCode = NaN)).toThrow(
      `The value of \"code\" is out of range. It must be an integer. Received NaN`,
    );
    expect(() => (process.exitCode = Infinity)).toThrow(
      `The value of \"code\" is out of range. It must be an integer. Received Infinity`,
    );
    expect(() => (process.exitCode = -Infinity)).toThrow(
      `The value of \"code\" is out of range. It must be an integer. Received -Infinity`,
    );
  });

  it("works with implicit process.exit", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "process-exitCode-with-exit.js"), "42"],
      env: bunEnv,
    });
    expect(exitCode).toBe(42);
    expect(stdout.toString().trim()).toBe("PASS");
  });

  it("works with explicit process.exit", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "process-exitCode-fixture.js"), "42"],
      env: bunEnv,
    });
    expect(exitCode).toBe(42);
    expect(stdout.toString().trim()).toBe("PASS");
  });
});

it("process exitCode range (#6284)", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "process-exitCode-fixture.js"), "255"],
    env: bunEnv,
  });
  expect(exitCode).toBe(255);
  expect(stdout.toString().trim()).toBe("PASS");
});

it("process.exit", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "process-exit-fixture.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString().trim()).toBe("PASS");
});

describe.concurrent(() => {
  it.todoIf(isMacOS)("should be the node version on the host that we expect", async () => {
    const subprocess = Bun.spawn({
      cmd: ["node", "--version"],
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: bunEnv,
    });

    let [out, exited] = await Promise.all([new Response(subprocess.stdout).text(), subprocess.exited]);
    expect(out.trim()).toEqual("v24.3.0");
    expect(exited).toBe(0);
  });

  it("process.mainModule (CJS)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "process-mainModule-fixture.js")],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    expect(await proc.exited).toBe(0);
  });

  it("process.mainModule (ESM)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "process-mainModule-fixture.esm.mjs")],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    expect(await proc.exited).toBe(0);
  });

  describe("process.onBeforeExit", () => {
    it("emitted", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "process-onBeforeExit-fixture.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("beforeExit\nexit");
    });

    it("works with explicit process.exit", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "process-onBeforeExit-keepAlive.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("beforeExit: 0\nbeforeExit: 1\nexit: 2");
    });

    it("throwing inside preserves exit code", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `process.on("beforeExit", () => {throw new Error("boom")});`],
        env: bunEnv,
        stdio: ["inherit", "pipe", "pipe"],
      });
      const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(1);
      expect(stderr).toInclude("error: boom");
      expect(stdout).toBeEmpty();
    });
  });

  describe("process.onExit", () => {
    it("throwing inside preserves exit code", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `process.on("exit", () => {throw new Error("boom")});`],
        env: bunEnv,
        stdio: ["inherit", "pipe", "pipe"],
      });
      const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(1);
      expect(stderr).toInclude("error: boom");
      expect(stdout).toBeEmpty();
    });
  });

  it("process.memoryUsage", () => {
    expect(process.memoryUsage()).toEqual({
      rss: expect.any(Number),
      heapTotal: expect.any(Number),
      heapUsed: expect.any(Number),
      external: expect.any(Number),
      arrayBuffers: expect.any(Number),
    });
  });

  it("process.memoryUsage.rss", () => {
    expect(process.memoryUsage.rss()).toEqual(expect.any(Number));
  });

  describe("process.cpuUsage", () => {
    it("works", () => {
      expect(process.cpuUsage()).toEqual({
        user: expect.any(Number),
        system: expect.any(Number),
      });
    });

    it("throws for negative input", () => {
      expect(() =>
        process.cpuUsage({
          user: -1,
          system: 100,
        }),
      ).toThrow("The property 'prevValue.user' is invalid. Received -1");
      expect(() =>
        process.cpuUsage({
          user: 100,
          system: -1,
        }),
      ).toThrow("The property 'prevValue.system' is invalid. Received -1");
    });

    // Skipped on Windows because it seems UV returns { user: 15000, system: 0 } constantly
    it.skipIf(process.platform === "win32")("works with diff", () => {
      const init = process.cpuUsage();
      init.system = 0;
      init.user = 0;
      const delta = process.cpuUsage(init);
      expect(delta.user).toBeGreaterThan(0);
      expect(delta.system).toBeGreaterThanOrEqual(0);
    });

    it.skipIf(process.platform === "win32")("works with diff of different structure", () => {
      const init = {
        system: 0,
        user: 0,
      };
      const delta = process.cpuUsage(init);
      expect(delta.user).toBeGreaterThan(0);
      expect(delta.system).toBeGreaterThanOrEqual(0);
    });

    it("throws on invalid property", () => {
      const fixtures = [
        {},
        { user: null },
        { user: {} },
        { user: "potato" },

        { user: 123 },
        { user: 123, system: null },
        { user: 123, system: "potato" },
      ];
      for (const fixture of fixtures) {
        expect(() => process.cpuUsage(fixture)).toThrow();
      }
    });

    // Skipped on Linux/Windows because it seems to not change as often as on macOS
    it.skipIf(process.platform !== "darwin")("increases monotonically", () => {
      const init = process.cpuUsage();
      let start = performance.now();
      while (performance.now() - start < 10) {}
      const another = process.cpuUsage();
      expect(another.user).toBeGreaterThan(init.user);
      expect(another.system).toBeGreaterThan(init.system);
    });
  });

  if (process.platform !== "win32") {
    it("process.getegid", () => {
      expect(typeof process.getegid()).toBe("number");
    });
    it("process.geteuid", () => {
      expect(typeof process.geteuid()).toBe("number");
    });
    it("process.getgid", () => {
      expect(typeof process.getgid()).toBe("number");
    });
    it("process.getgroups", () => {
      expect(process.getgroups()).toBeInstanceOf(Array);
      expect(process.getgroups().length).toBeGreaterThan(0);
    });
    it("process.getuid", () => {
      expect(typeof process.getuid()).toBe("number");
    });
  } else {
    it("process.getegid, process.geteuid, process.getgid, process.getgroups, process.getuid, process.getuid are not implemented on Windows", () => {
      expect(process.getegid).toBeUndefined();
      expect(process.geteuid).toBeUndefined();
      expect(process.getgid).toBeUndefined();
      expect(process.getgroups).toBeUndefined();
      expect(process.getuid).toBeUndefined();
      expect(process.getuid).toBeUndefined();
    });
  }

  describe("signal", () => {
    const fixture = join(import.meta.dir, "./process-signal-handler.fixture.js");
    it.skipIf(isWindows)("simple case works", async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), fixture, "SIGUSR1"],
        env: bunEnv,
        stderr: "inherit",
      });

      expect(await child.exited).toBe(0);
      expect(await new Response(child.stdout).text()).toBe("PASS\n");
    });
    it.skipIf(isWindows)("process.emit will call signal events", async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), fixture, "SIGUSR2"],
        env: bunEnv,
      });

      expect(await child.exited).toBe(0);
      expect(await new Response(child.stdout).text()).toBe("PASS\n");
    });

    it.serial("process.kill(2) works", async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), process_sleep, "1000000"],
        stdout: "pipe",
        cwd: import.meta.dir,
        env: bunEnv,
        stderr: "inherit",
      });
      const prom = child.exited;
      const ret = process.kill(child.pid, "SIGTERM");
      expect(ret).toBe(true);
      await prom;
      if (process.platform === "win32") {
        expect(child.exitCode).toBe(1);
      } else {
        expect(child.signalCode).toBe("SIGTERM");
      }
    });

    it.serial("process._kill(2) works", async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), process_sleep, "1000000"],
        stdout: "pipe",
        env: bunEnv,
      });
      const prom = child.exited;
      // SIGKILL as a number
      const SIGKILL = 9;
      process._kill(child.pid, SIGKILL);
      await prom;

      if (process.platform === "win32") {
        expect(child.exitCode).toBe(1);
      } else {
        expect(child.signalCode).toBe("SIGKILL");
      }
    });

    it("process.kill(2) throws on invalid input", async () => {
      expect(() => process.kill(2147483640, "SIGPOOP")).toThrow();
      expect(() => process.kill(2147483640, 456)).toThrow();
    });
  });

  const undefinedStubs = [
    "_debugEnd",
    "_debugProcess",
    "_fatalException",
    "_linkedBinding",
    "_rawDebug",
    "_startProfilerIdleNotifier",
    "_stopProfilerIdleNotifier",
    "_tickCallback",
  ];

  for (const stub of undefinedStubs) {
    it(`process.${stub}`, () => {
      expect(process[stub]()).toBeUndefined();
    });
  }

  const arrayStubs = ["getActiveResourcesInfo", "_getActiveRequests", "_getActiveHandles"];

  for (const stub of arrayStubs) {
    it(`process.${stub}`, () => {
      expect(process[stub]()).toBeInstanceOf(Array);
    });
  }

  const emptyObjectStubs = [];
  const emptySetStubs = ["allowedNodeEnvironmentFlags"];
  const emptyArrayStubs = ["moduleLoadList", "_preload_modules"];

  for (const stub of emptyObjectStubs) {
    it(`process.${stub}`, () => {
      expect(process[stub]).toEqual({});
    });
  }

  for (const stub of emptySetStubs) {
    it(`process.${stub}`, () => {
      expect(process[stub]).toBeInstanceOf(Set);
      expect(process[stub].size).toBe(0);
    });
  }

  for (const stub of emptyArrayStubs) {
    it(`process.${stub}`, () => {
      expect(process[stub]).toBeInstanceOf(Array);
      expect(process[stub]).toHaveLength(0);
    });
  }

  it("dlopen args parsing", () => {
    const notFound = join(tmpdirSync(), "not-found.so");
    expect(() => process.dlopen({ module: "42" }, notFound)).toThrow();
    expect(() => process.dlopen({ module: 42 }, notFound)).toThrow();
    expect(() => process.dlopen({ module: { exports: "42" } }, notFound)).toThrow();
    expect(() => process.dlopen({ module: { exports: 42 } }, notFound)).toThrow();
    expect(() => process.dlopen({ module: Symbol() }, notFound)).toThrow();
    expect(() => process.dlopen({ module: { exports: Symbol("123") } }, notFound)).toThrow();
    expect(() => process.dlopen({ module: { exports: Symbol("123") } }, Symbol("badddd"))).toThrow();
  });

  it("dlopen accepts file: URLs", () => {
    const mod = { exports: {} };
    try {
      process.dlopen(mod, import.meta.url);
      throw "Expected error";
    } catch (e) {
      expect(e.message).not.toContain("file:");
    }

    expect(() => process.dlopen(mod, "file://asd[kasd[po@[p1o23]1po!-10923-095-@$@8123=-9123=-0==][pc;!")).toThrow(
      "invalid file: URL passed to dlopen",
    );
  });

  it("process.constrainedMemory()", () => {
    expect(process.constrainedMemory() >= 0).toBe(true);
  });

  it("process.report", () => {
    // TODO: write better tests
    JSON.stringify(process.report.getReport(), null, 2);
  });

  it("process.exit with jsDoubleNumber that is an integer", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "./process-exit-decimal-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  if (isWindows) {
    it("ownKeys trap windows process.env", () => {
      expect(() => Object.keys(process.env)).not.toThrow();
      expect(() => Object.getOwnPropertyDescriptors(process.env)).not.toThrow();
    });
  }

  it("catches exceptions with process.setUncaughtExceptionCaptureCallback", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-uncaughtExceptionCaptureCallback.js")]);
    expect(await proc.exited).toBe(42);
  });

  it("catches exceptions with process.on('uncaughtException', fn)", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-onUncaughtException.js")]);
    expect(await proc.exited).toBe(42);
  });

  it("catches exceptions with process.on('uncaughtException', fn) from setTimeout", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-onUncaughtExceptionSetTimeout.js")]);
    expect(await proc.exited).toBe(42);
  });

  it("catches exceptions with process.on('unhandledRejection', fn)", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-onUnhandledRejection.js")]);
    expect(await proc.exited).toBe(42);
  });

  it("aborts when the uncaughtException handler throws", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-onUncaughtExceptionAbort.js")], {
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(7);
    expect(await proc.stderr.text()).toContain("bar");
  });

  it("aborts when the uncaughtExceptionCaptureCallback throws", async () => {
    const proc = Bun.spawn([bunExe(), join(import.meta.dir, "process-uncaughtExceptionCaptureCallbackAbort.js")], {
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(1);
    expect(await proc.stderr.text()).toContain("bar");
  });
});

it("process.hasUncaughtExceptionCaptureCallback", () => {
  process.setUncaughtExceptionCaptureCallback(null);
  expect(process.hasUncaughtExceptionCaptureCallback()).toBe(false);
  process.setUncaughtExceptionCaptureCallback(() => {});
  expect(process.hasUncaughtExceptionCaptureCallback()).toBe(true);
  process.setUncaughtExceptionCaptureCallback(null);
});

it("process.execArgv", async () => {
  const fixtures = [
    ["index.ts --bun -a -b -c", [], ["--bun", "-a", "-b", "-c"]],
    ["--bun index.ts index.ts", ["--bun"], ["index.ts"]],
    ["run -e bruh -b index.ts foo -a -b -c", ["-e", "bruh", "-b"], ["foo", "-a", "-b", "-c"]],
  ];

  for (const [cmd, execArgv, argv] of fixtures) {
    const replacedCmd = cmd.replace("index.ts", Bun.$.escape(join(__dirname, "print-process-execArgv.js")));
    const result = await Bun.$`${bunExe()} ${{ raw: replacedCmd }}`.json();
    expect(result, `bun ${cmd}`).toEqual({ execArgv, argv });
  }
});

describe("process.exitCode", () => {
  it("normal", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));
    `,
      "beforeExit 0 undefined\nexit 0 undefined\n",
      0,
    );
  });

  it("setter", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      process.exitCode = 0;
    `,
      "beforeExit 0 0\nexit 0 0\n",
      0,
    );
  });

  it("setter non-zero", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      process.exitCode = 3;
    `,
      "beforeExit 3 3\nexit 3 3\n",
      3,
    );
  });

  it("exit", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      process.exit(0);
    `,
      "exit 0 0\n",
      0,
    );
  });

  it("exit non-zero", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      process.exit(3);
    `,
      "exit 3 3\n",
      3,
    );
  });

  it("property access on undefined", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      const x = {};
      x.y.z();
    `,
      "exit 1 1\n",
      1,
    );
  });

  it("thrown Error", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      throw new Error("oops");
    `,
      "exit 1 1\n",
      1,
    );
  });

  it("unhandled rejected promise", async () => {
    await runInlineFixture(
      `
      process.on("exit", (code) => console.log("exit", code, process.exitCode));
      process.on("beforeExit", (code) => console.log("beforeExit", code, process.exitCode));

      await Promise.reject();
    `,
      "exit 1 1\n",
      1,
    );
  });

  it("exitsOnExitCodeSet", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.exitCode = 42;
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 42);
        assert.strictEqual(code, 42);
      });
    `,
      "",
      42,
    );
  });

  it("changesCodeViaExit", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.exitCode = 99;
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 42);
        assert.strictEqual(code, 42);
      });
      process.exit(42);
    `,
      "",
      42,
    );
  });

  it("changesCodeZeroExit", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.exitCode = 99;
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 0);
        assert.strictEqual(code, 0);
      });
      process.exit(0);
    `,
      "",
      0,
    );
  });

  it("exitWithOneOnUncaught", async () => {
    await runInlineFixture(
      `
      process.exitCode = 99;
      process.on('exit', (code) => {
        // cannot use assert because it will be uncaughtException -> 1 exit code that will render this test useless
        if (code !== 1 || process.exitCode !== 1) {
          console.log('wrong code! expected 1 for uncaughtException');
          process.exit(99);
        }
      });
      throw new Error('ok');
    `,
      "",
      1,
    );
  });

  it("changeCodeInsideExit", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.exitCode = 95;
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 95);
        assert.strictEqual(code, 95);
        process.exitCode = 99;
      });
    `,
      "",
      99,
    );
  });

  it.todoIf(isWindows)("zeroExitWithUncaughtHandler", async () => {
    await runInlineFixture(
      `
      process.on('exit', (code) => {
        if (code !== 0) {
          console.log('wrong code! expected 0; got', code);
          process.exit(99);
        }
        if (process.exitCode !== undefined) {
          console.log('wrong exitCode! expected undefined; got', process.exitCode);
          process.exit(99);
        }
      });
      process.on('uncaughtException', () => { });
      throw new Error('ok');
    `,
      "",
      0,
    );
  });

  it.todoIf(isWindows)("changeCodeInUncaughtHandler", async () => {
    await runInlineFixture(
      `
      process.on('exit', (code) => {
        if (code !== 97) {
          console.log('wrong code! expected 97; got', code);
          process.exit(99);
        }
        if (process.exitCode !== 97) {
          console.log('wrong exitCode! expected 97; got', process.exitCode);
          process.exit(99);
        }
      });
      process.on('uncaughtException', () => {
        process.exitCode = 97;
      });
      throw new Error('ok');
    `,
      "",
      97,
    );
  });

  it("changeCodeInExitWithUncaught", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 1);
        assert.strictEqual(code, 1);
        process.exitCode = 98;
      });
      throw new Error('ok');
    `,
      "",
      98,
    );
  });

  it("exitWithZeroInExitWithUncaught", async () => {
    await runInlineFixture(
      `
      const assert = require('assert');
      process.on('exit', (code) => {
        assert.strictEqual(process.exitCode, 1);
        assert.strictEqual(code, 1);
        process.exitCode = 0;
      });
      throw new Error('ok');
    `,
      "",
      0,
    );
  });

  it("exitWithThrowInUncaughtHandler", async () => {
    await runInlineFixture(
      `
      process.on('uncaughtException', () => {
        throw new Error('ok')
      });
      throw new Error('bad');
    `,
      "",
      7,
    );
  });

  it.todo("exitWithUndefinedFatalException", async () => {
    await runInlineFixture(
      `
      process._fatalException = undefined;
      throw new Error('ok');
    `,
      "",
      6,
    );
  });
});

it("process._exiting", () => {
  expect(process._exiting).toBe(false);
});

it("process.memoryUsage.arrayBuffers", () => {
  const initial = process.memoryUsage().arrayBuffers;
  const array = new ArrayBuffer(1024 * 1024 * 16);
  array.buffer;
  expect(process.memoryUsage().arrayBuffers).toBeGreaterThanOrEqual(initial + 16 * 1024 * 1024);
});

it("should handle user assigned `default` properties", async () => {
  process.default = 1;
  process.hello = 2;
  const { promise, resolve } = Promise.withResolvers();
  import("node:process").then(processModule => {
    expect(processModule.default).toBe(process);
    expect(processModule.default.default).toBe(1);
    expect(processModule.hello).toBe(2);
    expect(processModule.default.hello).toBe(2);
    resolve();
  });

  await promise;
});

it.each(["stdin", "stdout", "stderr"])("%s stream accessor should handle exceptions without crashing", async stream => {
  await runInlineFixture(
    /* js */ `
      const old = process;
      process = null;
      try {
        old.${stream};
      } catch {}
      if (typeof old.${stream} !== "undefined") {
        console.log("wrong");
      }
    `,
    "",
    1,
  );
});

it("process.versions", () => {
  expect(process.versions.node).toEqual("24.3.0");
  expect(process.versions.v8).toEqual("13.6.233.10-node.18");
  expect(process.versions.napi).toEqual("10");
  expect(process.versions.modules).toEqual("137");
});
