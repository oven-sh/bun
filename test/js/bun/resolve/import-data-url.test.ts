import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("dynamic import derives the loader from the MIME type", async () => {
  const url = [
    "data:text/javascript;charset=UTF-8,",
    "export%20const%20timestamp%3D%222026-09-03T00%3A00%3A00.000Z%22%3B",
    "export%20const%20percent%3D%22%2525%22%3B",
    "export%20const%20invalidEscape%3D%22%ZZ%22%3B",
    "export%20const%20moduleUrl%3Dimport.meta.url",
  ].join("");

  const first = await import(url);
  const second = await import(url);

  expect({
    timestamp: first.timestamp,
    percent: first.percent,
    invalidEscape: first.invalidEscape,
    moduleUrl: first.moduleUrl,
    cached: first === second,
  }).toEqual({
    timestamp: "2026-09-03T00:00:00.000Z",
    percent: "%25",
    invalidEscape: "%ZZ",
    moduleUrl: url,
    cached: true,
  });
});

test("a question mark in the payload is source, not a query string", async () => {
  const ns = await import("data:text/javascript,export default 1 ? 2 : 3;");
  expect(ns.default).toBe(2);
});

test.each(["json", "css", "cjs", "node", "wasm", "html", "sqlite", "toml", "yaml", "sh", "md", "txt"])(
  "a JavaScript payload that ends in .%s still loads as JavaScript",
  async ext => {
    const ns = await import(`data:text/javascript,export default 1.5;//x.${ext}`);
    expect(ns.default).toBe(1.5);
  },
);

test.each([
  "text/javascript",
  "text/javascript;charset=utf-8",
  "application/javascript",
  "application/javascript;charset=utf-8",
  "TEXT/JAVASCRIPT",
  " text/javascript ",
])("%s loads as JavaScript", async mime => {
  const ns = await import(`data:${mime},export default [1, 2].length + 0.5;`);
  expect(ns.default).toBe(2.5);
});

test("an absent MIME type keeps Bun's permissive JavaScript loader", async () => {
  const ns = await import("data:,export default 2.5;");
  expect(ns.default).toBe(2.5);
});

test("base64 JavaScript payloads still load", async () => {
  const code = Buffer.from("export default '2026-09-03T00:00:00.000Z';").toString("base64");
  const ns = await import(`data:text/javascript;charset=utf-8;base64,${code}`);
  expect(ns.default).toBe("2026-09-03T00:00:00.000Z");
});

test.each(["application/json", "Application/JSON"])("%s loads as JSON", async mime => {
  const payload = encodeURIComponent(JSON.stringify({ a: 1.5, b: "x.y" }));
  const ns = await import(`data:${mime},${payload}`);
  expect(ns.default).toEqual({ a: 1.5, b: "x.y" });
});

test("text/css loads with the CSS loader", async () => {
  const ns = await import("data:text/css,body{color:red}");
  expect(ns.default).toEqual({});
});

test.each(["text/javascript", "application/javascript"])("TypeScript syntax in %s is a syntax error", async mime => {
  const code = "export enum State { Ready }";
  await expect(import(`data:${mime},${encodeURIComponent(code)}`)).rejects.toThrow("Unexpected enum");
});

test("errors from nested data: URL modules propagate", async () => {
  const inner = `data:text/javascript,${encodeURIComponent('throw new Error("boom.1")')}`;
  const outer = `data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(inner)}`)}`;
  await expect(import(outer)).rejects.toThrow("boom.1");
});

test("static import derives the loader from the MIME type", async () => {
  using dir = tempDir("import-data-url-static", {
    "entry.mjs": [
      `import value, { name } from "data:text/javascript,export const name = 'a.b'; export default [1, 2].length;";`,
      `console.log(JSON.stringify({ value, name }));`,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ value: 2, name: "a.b" }),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("Bun.build inlines application/javascript data: URL modules", async () => {
  using dir = tempDir("import-data-url-build", {
    "entry.js": `import value from "data:application/javascript,export default 1.5;";\nconsole.log(value);`,
  });
  const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")] });
  expect(result.success).toBe(true);
  const out = await result.outputs[0].text();
  expect(out).not.toContain('"data:');
  expect(out).toContain("= 1.5");
});
