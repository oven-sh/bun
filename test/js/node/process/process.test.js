import { resolveSync, which } from "bun";
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "fs";
import { basename, resolve } from "path";

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

const versions = existsSync(import.meta.dir + "/../../src/generated_versions_list.zig");
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
    readFileSync(import.meta.dir + "/../../src/generated_versions_list.zig", "utf8")
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
