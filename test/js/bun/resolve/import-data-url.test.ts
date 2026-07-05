import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// A `data:` URL is typed by its MIME prefix, never by its payload. The module
// loader used to run the specifier through the file-path machinery anyway: `?`
// started a query string and everything after the payload's last `.` became the
// file extension, so `data:text/javascript,export default 1.5;` loaded with the
// `file` loader and exported the URL itself.

test("dynamic import evaluates the whole payload", async () => {
  const ns = await import("data:text/javascript,export default 1.5;globalThis.__dataUrlRan = 44;");
  expect(ns.default).toBe(1.5);
  expect((globalThis as any).__dataUrlRan).toBe(44);
});

test("a `?` in the payload is source, not a query string", async () => {
  const ns = await import("data:text/javascript,export default 1 ? 2 : 3;");
  expect(ns.default).toBe(2);
});

// Each of these used to pick a different loader out of the payload: `.json`
// tried to parse the source as JSON, `.md` rendered it as markdown, `.sqlite`
// opened a database, `.node` reported it as a Node-API addon.
test.each(["json", "css", "cjs", "node", "wasm", "html", "sqlite", "toml", "yaml", "sh", "md", "txt"])(
  "a payload that looks like it ends in .%s",
  async ext => {
    const ns = await import(`data:text/javascript,export default 1.5;//x.${ext}`);
    expect(ns.default).toBe(1.5);
  },
);

test.each(["text/javascript", "text/javascript;charset=utf-8", "application/javascript"])(
  "%s loads as a module",
  async mime => {
    const ns = await import(`data:${mime},export default [1, 2].length + 0.5;`);
    expect(ns.default).toBe(2.5);
  },
);

test("base64 payloads load", async () => {
  const code = Buffer.from("export default 1.5;").toString("base64");
  const ns = await import(`data:text/javascript;base64,${code}`);
  expect(ns.default).toBe(1.5);
});

test("application/json loads as JSON", async () => {
  const payload = encodeURIComponent(JSON.stringify({ a: 1.5, b: "x.y" }));
  const ns = await import(`data:application/json,${payload}`);
  expect(ns.default).toEqual({ a: 1.5, b: "x.y" });
});

test("static import of a data: URL", async () => {
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

test("Bun.build inlines data: URL modules", async () => {
  using dir = tempDir("import-data-url-build", {
    "entry.js": `import a from "data:application/javascript,export default 1.5;";\nconsole.log(a);`,
  });
  const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")] });
  expect(result.success).toBe(true);
  const out = await result.outputs[0].text();
  // `application/javascript` was classified as a non-module MIME type, so the
  // import was marked external and survived into the bundle as a string literal.
  expect(out).not.toContain('"data:');
  expect(out).toContain("= 1.5");
});
