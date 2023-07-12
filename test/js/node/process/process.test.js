import { spawnSync, which } from "bun";
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { basename, join, resolve } from "path";

it("process", () => {
  // this property isn't implemented yet but it should at least return a string
  const isNode = !process.isBun;

  if (!isNode && process.title !== "bun") throw new Error("process.title is not 'bun'");

  if (typeof process.env.USER !== "string") throw new Error("process.env is not an object");

  if (process.env.USER.length === 0) throw new Error("process.env is missing a USER property");

  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("process.platform is invalid");

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

it("process.hrtime()", () => {
  const start = process.hrtime();
  const end = process.hrtime(start);
  const end2 = process.hrtime();
  expect(end[0]).toBe(0);
  expect(end2[1] > start[1]).toBe(true);
});

it("process.hrtime.bigint()", () => {
  const start = process.hrtime.bigint();
  const end = process.hrtime.bigint();
  expect(end > start).toBe(true);
});

it("process.release", () => {
  expect(process.release.name).toBe("bun");
  expect(process.release.sourceUrl).toContain(
    `https://github.com/oven-sh/bun/release/bun-v${process.versions.bun}/bun-${process.platform}-${
      { arm64: "aarch64", x64: "x64" }[process.arch] || process.arch
    }`,
  );
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
  expect(eval(`globalThis.process.env.USER = "${orig}"`)).toBe(orig);
});

it("process.env.TZ", () => {
  var origTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // the default timezone is Etc/UTC
  if (!"TZ" in process.env) {
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
  let notNumbers = [265n, "string", true, false, null, {}, [], () => {}, Symbol("symbol"), BigInt(1)];
  for (let notNumber of notNumbers) {
    expect(() => {
      process.umask(notNumber);
    }).toThrow('The "mask" argument must be a number');
  }

  let rangeErrors = [NaN, -1.4, Infinity, -Infinity, -1, 1.3, 4294967296];
  for (let rangeError of rangeErrors) {
    expect(() => {
      process.umask(rangeError);
    }).toThrow(RangeError);
  }

  const orig = process.umask(0o777);
  expect(orig).toBeGreaterThan(0);
  expect(process.umask()).toBe(0o777);
  expect(process.umask(undefined)).toBe(0o777);
  expect(process.umask(Number(orig))).toBe(0o777);
  expect(process.umask()).toBe(orig);
});

const generated_versions_list = join(import.meta.dir, "../../../../src/generated_versions_list.zig");
const versions = existsSync(generated_versions_list);
(versions ? it : it.skip)("process.versions", () => {
  // Generate a list of all the versions in the versions object
  // example:
  // pub const boringssl = "b275c5ce1c88bc06f5a967026d3c0ce1df2be815";
  // pub const libarchive = "dc321febde83dd0f31158e1be61a7aedda65e7a2";
  // pub const mimalloc = "3c7079967a269027e438a2aac83197076d9fe09d";
  // pub const picohttpparser = "066d2b1e9ab820703db0837a7255d92d30f0c9f5";
  // pub const uws = "70b1b9fc1341e8b791b42c5447f90505c2abe156";
  // pub const webkit = "60d11703a533fd694cd1d6ddda04813eecb5d69f";
  // pub const zlib = "885674026394870b7e7a05b7bf1ec5eb7bd8a9c0";
  // pub const tinycc = "2d3ad9e0d32194ad7fd867b66ebe218dcc8cb5cd";
  // pub const lolhtml = "2eed349dcdfa4ff5c19fe7c6e501cfd687601033";
  // pub const c_ares = "0e7a5dee0fbb04080750cf6eabbe89d8bae87faa";
  // pub const usockets = "fafc241e8664243fc0c51d69684d5d02b9805134";
  const versions = Object.fromEntries(
    readFileSync(generated_versions_list, "utf8")
      .split("\n")
      .filter(line => line.startsWith("pub const") && !line.includes("zig") && line.includes(' = "'))
      .map(line => line.split(" = "))
      .map(([name, hash]) => [name.slice(9).trim(), hash.slice(1, -2)]),
  );
  versions.uwebsockets = versions.uws;
  delete versions.uws;
  versions["ares"] = versions.c_ares;
  delete versions.c_ares;

  for (const name in versions) {
    expect(process.versions).toHaveProperty(name);
    expect(process.versions[name]).toBe(versions[name]);
  }
});

it("process.config", () => {
  expect(process.config).toEqual({
    variables: {
      v8_enable_i8n_support: 1,
    },
    target_defaults: {},
  });
});

it("process.emitWarning", () => {
  process.emitWarning("-- Testing process.emitWarning --");
  var called = 0;
  process.on("warning", err => {
    called++;
    expect(err.message).toBe("-- Testing process.on('warning') --");
  });
  process.emitWarning("-- Testing process.on('warning') --");
  expect(called).toBe(1);
  expect(process.off("warning")).toBe(process);
  process.emitWarning("-- Testing process.on('warning') --");
  expect(called).toBe(1);
});

it("process.execArgv", () => {
  expect(process.execArgv instanceof Array).toBe(true);
});

it("process.binding", () => {
  expect(() => process.binding("buffer")).toThrow();
});

it("process.argv in testing", () => {
  expect(process.argv).toBeInstanceOf(Array);
  expect(process.argv[0]).toBe(bunExe());

  // assert we aren't creating a new process.argv each call
  expect(process.argv).toBe(process.argv);
});

describe("process.exitCode", () => {
  it("validates int", () => {
    expect(() => (process.exitCode = "potato")).toThrow("exitCode must be a number");
    expect(() => (process.exitCode = 1.2)).toThrow('The "code" argument must be an integer');
    expect(() => (process.exitCode = NaN)).toThrow('The "code" argument must be an integer');
    expect(() => (process.exitCode = Infinity)).toThrow('The "code" argument must be an integer');
    expect(() => (process.exitCode = -Infinity)).toThrow('The "code" argument must be an integer');
    expect(() => (process.exitCode = -1)).toThrow("exitCode must be between 0 and 127");
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

it("process.exit", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "process-exit-fixture.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString().trim()).toBe("PASS");
});

describe("process.onBeforeExit", () => {
  it("emitted", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "process-onBeforeExit-fixture.js")],
      env: bunEnv,
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("beforeExit\nexit");
  });

  it("works with explicit process.exit", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "process-onBeforeExit-keepAlive.js")],
      env: bunEnv,
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("beforeExit: 0\nbeforeExit: 1\nexit: 2");
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

  it("works with diff", () => {
    const init = process.cpuUsage();
    for (let i = 0; i < 1000; i++) {}
    const delta = process.cpuUsage(init);
    expect(delta.user).toBeGreaterThan(0);
    expect(delta.system).toBeGreaterThan(0);
  });

  it("works with diff of different structure", () => {
    const init = {
      user: 0,
      system: 0,
    };
    for (let i = 0; i < 1000; i++) {}
    const delta = process.cpuUsage(init);
    expect(delta.user).toBeGreaterThan(0);
    expect(delta.system).toBeGreaterThan(0);
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

  // Skipped on Linux because it seems to not change as often as on macOS
  it.skipIf(process.platform === "linux")("increases monotonically", () => {
    const init = process.cpuUsage();
    for (let i = 0; i < 10000; i++) {}
    const another = process.cpuUsage();
    expect(another.user).toBeGreaterThan(init.user);
    expect(another.system).toBeGreaterThan(init.system);
  });
});

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

it("process.getuid", () => {
  expect(typeof process.getuid()).toBe("number");
});

describe("signal", () => {
  const fixture = join(import.meta.dir, "./process-signal-handler.fixture.js");
  it("simple case works", async () => {
    const child = Bun.spawn({
      cmd: [bunExe(), fixture, "SIGUSR1"],
      env: bunEnv,
    });

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("PASS\n");
  });
  it("process.emit will call signal events", async () => {
    const child = Bun.spawn({
      cmd: [bunExe(), fixture, "SIGUSR2"],
      env: bunEnv,
    });

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("PASS\n");
  });

  it("process.kill(2) works", async () => {
    const child = Bun.spawn({
      cmd: ["bash", "-c", "sleep 1000000"],
      stdout: "pipe",
    });
    const prom = child.exited;
    process.kill(child.pid, "SIGTERM");
    await prom;
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("process._kill(2) works", async () => {
    const child = Bun.spawn({
      cmd: ["bash", "-c", "sleep 1000000"],
      stdout: "pipe",
    });
    const prom = child.exited;
    process.kill(child.pid, 9);
    await prom;
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("process.kill(2) throws on invalid input", async () => {
    expect(() => process.kill(0, "SIGPOOP")).toThrow();
    expect(() => process.kill(0, 456)).toThrow();
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

const emptyObjectStubs = ["_preload_modules"];
const emptySetStubs = ["allowedNodeEnvironmentFlags"];
const emptyArrayStubs = ["moduleLoadList"];

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
