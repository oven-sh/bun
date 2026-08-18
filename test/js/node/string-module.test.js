import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("should import and execute ES module from string", async () => {
  const code = `export default function test(arg) { return arg + arg };`;
  const mod = await import("data:text/javascript," + code).then(mod => mod.default);
  const result = mod(1);
  expect(result).toEqual(2);
});

test("should import and execute ES module from string (base64)", async () => {
  const code = `export default function test(arg) { return arg + arg; }`;
  const mod = await import("data:text/javascript;base64," + btoa(code)).then(mod => mod.default);
  const result = mod(1);
  expect(result).toEqual(2);
});

test("should throw when importing malformed string (base64)", async () => {
  expect(() => import("data:text/javascript;base64,asdasdasd")).toThrowError("Base64DecodeError");
});

// data: URLs carry the module source inline and never touch the filesystem,
// so no path-length limit applies. 200000 exceeds the largest platform cap
// (Windows, ~147 KB); the smallest (macOS) is ~1.5 KB.
test("should import a data: URL longer than the path-length limit", async () => {
  const big = Buffer.alloc(200000, "x").toString();
  const url = "data:text/javascript," + encodeURIComponent(`export default "${big}";`);
  const mod = await import(url);
  expect(mod.default).toBe(big);
});

test("should import a base64 data: URL longer than the path-length limit", async () => {
  const big = Buffer.alloc(200000, "y").toString();
  const url = "data:text/javascript;base64," + btoa(`export default "${big}";`);
  const mod = await import(url);
  expect(mod.default).toBe(big);
});

test("should keep '?' as part of the data in a data: URL", async () => {
  const mod = await import(`data:text/javascript,export default "a?b=c";`);
  expect(mod.default).toBe("a?b=c");
});

// https://github.com/oven-sh/bun/issues/32057
test("percent-encoded module containing a '.' keeps its named exports", async () => {
  const code = "export function f(){}\nf.m = 1\nexport const x = 1\n";
  const mod = await import("data:text/javascript," + encodeURIComponent(code));
  expect(Object.keys(mod)).toEqual(["f", "x"]);
  expect(mod.f.m).toBe(1);
  expect(mod.x).toBe(1);
});

test("base64 module containing a '.' keeps its named exports", async () => {
  const code = "export function f(){}\nf.m = 1\nexport const x = 1\n";
  const mod = await import("data:text/javascript;base64," + btoa(code));
  expect(Object.keys(mod)).toEqual(["f", "x"]);
  expect(mod.f.m).toBe(1);
});

test("raw unencoded module containing a '.' keeps its named exports", async () => {
  const mod = await import("data:text/javascript,export const value = Math.max(1, 2);");
  expect(Object.keys(mod)).toEqual(["value"]);
  expect(mod.value).toBe(2);
});

test.each([
  "text/javascript",
  "text/javascript;charset=utf-8",
  "application/javascript",
  "TEXT/JAVASCRIPT",
  " text/javascript ",
  "",
])("percent-encoded module with a '.' executes for MIME %j", async mime => {
  const code = `export const x = Number.parseFloat("1.5");`;
  const mod = await import(`data:${mime},` + encodeURIComponent(code));
  expect(Object.keys(mod)).toEqual(["x"]);
  expect(mod.x).toBe(1.5);
});

test("URL text ending in a known file extension is not sniffed as a loader", async () => {
  // The fake ".json" extension previously routed this through the JSON loader.
  const code = "export const x = 1 // tail.json";
  const mod = await import("data:text/javascript," + encodeURIComponent(code));
  expect(mod.x).toBe(1);
});

test.each(["application/json", "Application/JSON"])("%s data URL imports as JSON", async mime => {
  const mod = await import(`data:${mime},` + encodeURIComponent(`{"a": 1.5}`));
  expect(mod.default).toEqual({ a: 1.5 });
});

test("text/css data URL imports like a .css file", async () => {
  const mod = await import("data:text/css,body{color:red}");
  expect(Object.keys(mod)).toEqual(["__esModule", "default"]);
  expect(mod.default).toEqual({});
});

// https://github.com/oven-sh/bun/issues/29159
test.each(["text/javascript", "application/javascript", "Text/JavaScript", " text/javascript"])(
  "TypeScript syntax in a %s data URL is a syntax error",
  async mime => {
    const code = `export const a = "a.b";\nexport enum A { A }\n`;
    await expect(import(`data:${mime},` + encodeURIComponent(code))).rejects.toThrow("Unexpected enum");
    await expect(import(`data:${mime};base64,` + btoa(code))).rejects.toThrow("Unexpected enum");
  },
);

// https://github.com/oven-sh/bun/issues/28483
test("errors from imports nested inside a data URL module propagate", async () => {
  const inner = "data:text/javascript," + encodeURIComponent(`throw new Error("boom.1");`);
  const outer = "data:text/javascript," + encodeURIComponent(`import ${JSON.stringify(inner)};`);
  await expect(import(outer)).rejects.toThrow("boom.1");
});

test.concurrent("static import and require of percent-encoded data URLs with dots", async () => {
  const esmUrl = "data:text/javascript," + encodeURIComponent("export const obj = { a: 1.5 };\n");
  const cjsUrl = "data:text/javascript," + encodeURIComponent("module.exports = { b: 2.5 };\n");
  using dir = tempDir("data-url-import", {
    "index.mjs": `
      import { obj } from ${JSON.stringify(esmUrl)};
      import { createRequire } from "node:module";
      const cjs = createRequire(import.meta.url)(${JSON.stringify(cjsUrl)});
      console.log(JSON.stringify({ ...obj, ...cjs }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: `{"a":1.5,"b":2.5}\n`, stderr: "", exitCode: 0 });
});
