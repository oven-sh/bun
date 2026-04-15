import { expect, test } from "bun:test";
import { copyFileSync, existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";

// Client-side chunks (target=browser) are not printed with ascii_only and may
// contain raw UTF-8 bytes. They are normally only served to browsers, but if
// the server imports one as a module it goes through File.toWTFString(). This
// test guards against treating those bytes as Latin-1 in the standalone
// module graph, which would mojibake non-ASCII string literals.
test("compiled client-side chunk with non-ASCII source can be imported on the server", async () => {
  using dir = tempDir("compile-client-chunk-encoding", {
    "client.ts": `console.log("CLIENT_OUTPUT:", "こんにちは");\n`,
    "index.html": `<!doctype html><html><head><script type="module" src="./client.ts"></script></head><body></body></html>\n`,
    "server.ts": `
import index from "./index.html";
import { join } from "path";
void index;
console.log("DEBUG: embeddedFiles.length=", Bun.embeddedFiles.length);
for (const f of Bun.embeddedFiles) console.log("DEBUG: file=", (f as any).name);
const js = Bun.embeddedFiles.find(f => (f as any).name?.endsWith(".js"));
if (!js) throw new Error("no client chunk in embeddedFiles");
console.log("DEBUG: chosen js name=", (js as any).name);
const src = await js.text();
console.log("DEBUG: src length=", src.length);
console.log("DEBUG: src has JP=", src.includes("こんにちは"));
console.log("DEBUG: src head=", src.slice(0, 80));
console.log("DEBUG: import.meta.dir=", import.meta.dir);
const importPath = join(import.meta.dir, (js as any).name);
console.log("DEBUG: importPath=", importPath);
try {
  await import(importPath);
} catch (e) {
  console.log("IMPORT_ERROR:", String(e));
  throw e;
}
`,
  });

  const outfile = join(String(dir), isWindows ? "app.exe" : "app");
  const shim = join(dirname(bunExe()), "asan-dyld-shim.dylib");
  if (existsSync(shim)) copyFileSync(shim, join(String(dir), "asan-dyld-shim.dylib"));
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./server.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdoutB, stderrB, exitCodeB] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    console.log("BUILD stdout:", stdoutB);
    console.log("BUILD stderr:", stderrB);
    console.log("BUILD exitCode:", exitCodeB);
    console.log("BUILD outfile exists:", existsSync(outfile));
    expect(stderrB).not.toContain("error:");
    expect(exitCodeB).toBe(0);
  }

  await using proc = Bun.spawn({
    cmd: [outfile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log("RUN stdout:", stdout);
  console.log("RUN stderr:", stderr);
  console.log("RUN exitCode:", exitCode);
  expect(stderr).toBe("");
  expect(stdout).toContain("CLIENT_OUTPUT: こんにちは");
  expect(exitCode).toBe(0);
}, 60_000);
