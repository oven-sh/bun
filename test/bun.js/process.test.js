import { resolveSync } from "bun";
import { describe, expect, it } from "bun:test";
import { realpathSync } from "fs";

it("process", () => {
  // this property isn't implemented yet but it should at least return a string
  const isNode = !process.isBun;

  if (!isNode && process.title !== "bun")
    throw new Error("process.title is not 'bun'");

  if (typeof process.env.USER !== "string")
    throw new Error("process.env is not an object");

  if (process.env.USER.length === 0)
    throw new Error("process.env is missing a USER property");

  if (process.platform !== "darwin" && process.platform !== "linux")
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
    throw new Error(
      "process.env should call toJSON to hide its internal state",
    );
  }

  var { env, ...proces } = process;
  console.log(proces);

  console.log("CWD", process.cwd());
  console.log("SET CWD", process.chdir("../"));
  console.log("CWD", process.cwd());
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
  expect(process.release.sourceUrl).toBe(
    `https://github.com/oven-sh/bun/release/bun-v${process.versions.bun}/bun-${
      process.platform
    }-${{ arm64: "aarch64", x64: "x64" }[process.arch] || process.arch}.zip`,
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
  const orig = ((getter) => process.env[getter])("USER");
  expect(process.env).toEqual(process.env);
  eval(`globalThis.process.env.USER = 'bun';`);
  expect(eval(`globalThis.process.env.USER`)).toBe("bun");
  expect(eval(`globalThis.process.env.USER = "${orig}"`)).toBe(orig);
});

it("process.version starts with v", () => {
  expect(process.version.startsWith("v")).toBeTruthy();
});

it("process.argv0", () => {
  expect(process.argv0).toBe(process.argv[0]);
});

it("process.execPath", () => {
  expect(process.execPath).toBe(realpathSync(process.argv0));
});

it("process.uptime()", () => {
  expect(process.uptime()).toBeGreaterThan(0);
  expect(Math.floor(process.uptime())).toBe(
    Math.floor(performance.now() / 1000),
  );
});

it("process.umask()", () => {
  const orig = process.umask(777);
  expect(orig).toBeGreaterThan(0);
  expect(process.umask(orig)).toBe(777);
});
