// https://github.com/oven-sh/bun/issues/26713
//
// When a file referenced from an HTML route (or passed to Bun.build) carries
// its own `//# sourceMappingURL=<file>.map` comment, the bundler should chain
// through that input sourcemap so the emitted map's `sources` point at the
// authored source, not the intermediate `.js`.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const originalSource = `interface Foo { bar: string }
const x: Foo = { bar: "hello from main.ts" };
console.log(x.bar);
`;

async function makeFixture() {
  const dir = tempDir("26713", {
    "src/main.ts": originalSource,
    "index.html": `<!DOCTYPE html><html><body><script type="module" src="./main.js"></script></body></html>`,
  });
  // Step 1: pre-build src/main.ts -> main.js + main.js.map (linked sourcemap).
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/main.ts", "--sourcemap=linked", "--outdir", "./"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.includes("main.js"), stderr, code }).toEqual({ stdout: true, stderr: "", code: 0 });
  // Sanity: the pre-built map points at the original source.
  const prebuiltMap = await Bun.file(join(String(dir), "main.js.map")).json();
  expect(prebuiltMap.sources).toEqual(["src/main.ts"]);
  return dir;
}

describe.concurrent("input sourcemap chaining for external .map references (#26713)", () => {
  test("Bun.serve HTML route with development: true (dev server)", async () => {
    using dir = await makeFixture();
    const fixture = `
      import index from "./index.html";
      const server = Bun.serve({ port: 0, routes: { "/": index }, development: true });
      const html = await fetch(server.url).then(r => r.text());
      const src = html.match(/src="([^"]+)"/)[1];
      const jsUrl = new URL(src, server.url);
      const js = await fetch(jsUrl).then(r => r.text());
      const mapUrl = js.match(/sourceMappingURL=(\\S+)/)[1];
      const map = await fetch(new URL(mapUrl, jsUrl)).then(r => r.json());
      process.stdout.write(JSON.stringify({
        sources: map.sources,
        sourcesContent: map.sourcesContent,
        sourcesLen: map.sources.length,
        contentLen: map.sourcesContent.length,
      }));
      server.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    const out = JSON.parse(stdout);
    // The original TypeScript source must appear in the emitted sourcemap.
    expect(out.sources.some((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"))).toBe(true);
    // sources and sourcesContent must be the same length (slot alignment).
    expect(out.sourcesLen).toBe(out.contentLen);
    // The slot for src/main.ts must carry the authored source text so the
    // browser can show the original file without fetching it.
    const tsIdx = out.sources.findIndex((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"));
    expect(out.sourcesContent[tsIdx]).toBe(originalSource);
    expect(exitCode).toBe(0);
  });

  test("Bun.serve HTML route with development: false (prod bundler)", async () => {
    using dir = await makeFixture();
    const fixture = `
      import index from "./index.html";
      const server = Bun.serve({ port: 0, routes: { "/": index }, development: false });
      const html = await fetch(server.url).then(r => r.text());
      const src = html.match(/src="([^"]+)"/)[1];
      const jsUrl = new URL(src, server.url);
      const js = await fetch(jsUrl).then(r => r.text());
      const mapUrl = js.match(/sourceMappingURL=(\\S+)/)[1];
      const map = await fetch(new URL(mapUrl, jsUrl)).then(r => r.json());
      process.stdout.write(JSON.stringify({ sources: map.sources }));
      server.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    const out = JSON.parse(stdout);
    expect(out.sources.some((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("Bun.build entrypoint with external .map", async () => {
    using dir = await makeFixture();
    const result = await Bun.build({
      entrypoints: [join(String(dir), "main.js")],
      sourcemap: "external",
      outdir: join(String(dir), "out"),
    });
    expect(result.success).toBe(true);
    const mapFile = result.outputs.find(o => o.path.endsWith(".map"));
    expect(mapFile).toBeDefined();
    const map = await Bun.file(mapFile!.path).json();
    expect(map.sources.some((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"))).toBe(true);
    // sourcesContent must carry the authored source.
    const tsIdx = map.sources.findIndex((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"));
    expect(map.sourcesContent[tsIdx]).toBe(originalSource);
  });

  test("external .map with sourceRoot is prepended to inner source paths", async () => {
    using dir = tempDir("26713-sourceroot", {
      "dist/main.js": `console.log("hi");\n//# sourceMappingURL=main.js.map\n`,
      "dist/main.js.map": JSON.stringify({
        version: 3,
        sourceRoot: "../src/",
        sources: ["main.ts"],
        sourcesContent: ['console.log("hi");\n'],
        names: [],
        mappings: "AAAA",
      }),
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "dist", "main.js")],
      sourcemap: "external",
      outdir: join(String(dir), "out"),
    });
    expect(result.success).toBe(true);
    const mapFile = result.outputs.find(o => o.path.endsWith(".map"));
    expect(mapFile).toBeDefined();
    const map = await Bun.file(mapFile!.path).json();
    // The inner source must resolve through sourceRoot: dist/main.js +
    // ../src/main.ts -> src/main.ts (not dist/main.ts).
    expect(map.sources.some((s: string) => s.replaceAll("\\", "/").endsWith("src/main.ts"))).toBe(true);
    expect(map.sources.some((s: string) => s.replaceAll("\\", "/").endsWith("dist/main.ts"))).toBe(false);
  });

  test("URL-style inner source names are passed through verbatim", async () => {
    using dir = tempDir("26713-url-sources", {
      "main.js": `console.log("hi");\n//# sourceMappingURL=main.js.map\n`,
      "main.js.map": JSON.stringify({
        version: 3,
        sources: ["webpack:///src/main.ts"],
        sourcesContent: ['console.log("hi");\n'],
        names: [],
        mappings: "AAAA",
      }),
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "main.js")],
      sourcemap: "external",
      outdir: join(String(dir), "out"),
    });
    expect(result.success).toBe(true);
    const mapFile = result.outputs.find(o => o.path.endsWith(".map"));
    expect(mapFile).toBeDefined();
    const map = await Bun.file(mapFile!.path).json();
    // webpack:// and similar URL schemes must survive untouched; joining
    // them against a filesystem dir would mangle them.
    expect(map.sources).toContain("webpack:///src/main.ts");
  });

  test("Bun.build with missing external .map falls back cleanly", async () => {
    using dir = tempDir("26713-missing", {
      "main.js": `console.log("hi");\n//# sourceMappingURL=does-not-exist.map\n`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "main.js")],
      sourcemap: "external",
      outdir: join(String(dir), "out"),
    });
    // The build must not fail; the output sourcemap falls back to the
    // intermediate without the chain.
    expect(result.success).toBe(true);
    const mapFile = result.outputs.find(o => o.path.endsWith(".map"));
    expect(mapFile).toBeDefined();
    const map = await Bun.file(mapFile!.path).json();
    expect(map.sources.some((s: string) => s.endsWith("main.js"))).toBe(true);
  });

  test("external .map with http:// URL is skipped, not fetched", async () => {
    using dir = tempDir("26713-http", {
      "main.js": `console.log("hi");\n//# sourceMappingURL=http://127.0.0.1:1/unreachable.map\n`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "main.js")],
      sourcemap: "external",
      outdir: join(String(dir), "out"),
    });
    expect(result.success).toBe(true);
  });
});
