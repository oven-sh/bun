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
const js = Bun.embeddedFiles.find(f => (f as any).name?.endsWith(".js"));
if (!js) throw new Error("no client chunk in embeddedFiles");
const src = await js.text();
if (!src.includes("こんにちは")) throw new Error("client chunk source is not raw UTF-8; test premise broken");
await import(join(import.meta.dir, (js as any).name));
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
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  await using proc = Bun.spawn({
    cmd: [outfile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("CLIENT_OUTPUT: こんにちは");
  expect(exitCode).toBe(0);
}, 60_000);
