// A package.json that is not UTF-8, as an editor that writes Latin-1 leaves it. A command that rewrites the file
// writes back the bytes that it read. What shows a value, and what writes another file, has U+FFFD for a lead byte
// that starts no sequence of UTF-8.
import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, textThatIsNotUtf8 } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "path";

// In UTF-8, 0xE9 starts a sequence of three bytes, and 0x82 and 0x9B start none.
const manifest =
  '{\n  "name": "app",\n  "version": "1.0.0",\n  "author": "Jos\xE9 P\xE9rez",\n  "homepage": "http://localhost/\x82A\x9BA"\n}\n';

/** Each character of `stdout` is a byte of the output. */
async function run(cwd: string, cmd: string[]) {
  await using proc = spawn({
    cmd,
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
  return { stdout: Buffer.from(stdout).toString("latin1"), stderr, exitCode };
}
const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);

/** Each character is a byte of the file. */
const bytesOf = async (dir: string, file: string) =>
  Buffer.from(await Bun.file(join(dir, file)).bytes()).toString("latin1");
const bytesOfText = (text: string) => Buffer.from(text).toString("latin1");

describe.concurrent("a package.json that is not UTF-8", () => {
  test("bun pm pkg get shows U+FFFD for a lead byte, and the bytes after it", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": Buffer.from(manifest, "latin1") });
    expect(await bun(String(dir), "pm", "pkg", "get", "author")).toEqual({
      stdout: bytesOfText('"Jos\uFFFD P\uFFFDrez"\n'),
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun pm pkg set writes back the bytes that it read", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": Buffer.from(manifest, "latin1") });
    expect(await bun(String(dir), "pm", "pkg", "set", "license=MIT")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bytesOf(String(dir), "package.json")).toBe(manifest.replace('"\n}', '",\n  "license": "MIT"\n}'));
  });

  test("bun pm pkg set writes back every sequence of bytes", async () => {
    const table = textThatIsNotUtf8(3);
    const lines = table.bytes.toString("latin1").slice(0, -1);
    const json = `{"name":"app","lines":["${lines.replaceAll("\n", '","')}"]}`;
    using dir = tempDir("package-json-not-utf8", { "package.json": Buffer.from(json, "latin1") });

    expect(await bun(String(dir), "pm", "pkg", "set", "license=MIT")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    // Half of a surrogate pair is written as an escape.
    const kept = lines.replace(/\xed([\xa0-\xbf])([\x80-\xbf])/g, (_, second, third) =>
      String.fromCharCode(0xd000 | ((second.charCodeAt(0) & 0x3f) << 6) | (third.charCodeAt(0) & 0x3f)),
    );
    const written = JSON.parse(await bytesOf(String(dir), "package.json"));
    expect(table.linesThatDiffer(written.lines.join("\n"), kept)).toEqual([]);
  });

  // Only a shell gives a program an argument that is not UTF-8.
  test.skipIf(isWindows)("bun pm pkg set writes the bytes of an argument", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": '{\n  "name": "app"\n}\n' });
    const set = `exec "$0" pm pkg set "author=$(printf 'Jos\\351 P\\351rez')"`;
    expect(await run(String(dir), ["sh", "-c", set, bunExe()])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bytesOf(String(dir), "package.json")).toBe('{\n  "name": "app",\n  "author": "Jos\xE9 P\xE9rez"\n}\n');
  });

  test("bun pm version writes back the bytes that it read", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": Buffer.from(manifest, "latin1") });
    expect(await bun(String(dir), "pm", "version", "patch", "--no-git-tag-version")).toEqual({
      stdout: "v1.0.1\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bytesOf(String(dir), "package.json")).toBe(manifest.replace("1.0.0", "1.0.1"));
  });

  test("bun add writes back the bytes that it read", async () => {
    using dir = tempDir("package-json-not-utf8", {
      "package.json": Buffer.from(manifest, "latin1"),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const { stderr, exitCode } = await bun(String(dir), "add", "file:./dep");
    expect(stderr).not.toContain("error:");
    expect(await bytesOf(String(dir), "package.json")).toBe(
      manifest.replace('"\n}', '",\n  "dependencies": {\n    "dep": "file:./dep"\n  }\n}'),
    );
    expect(exitCode).toBe(0);
  });

  // `bun add` reads the file again after it writes it. Only Linux has a folder with such a name.
  test.skipIf(!isLinux)("bun add takes a folder with a name that is not UTF-8", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": '{\n  "name": "app"\n}\n' });
    const folder = Buffer.concat([Buffer.from(String(dir)), Buffer.from("/caf\xE9/dep", "latin1")]);
    mkdirSync(folder, { recursive: true });
    writeFileSync(Buffer.concat([folder, Buffer.from("/package.json")]), '{ "name": "dep", "version": "1.0.0" }');

    const add = `exec "$0" add "./$(printf 'caf\\351')/dep"`;
    const { stderr, exitCode } = await run(String(dir), ["sh", "-c", add, bunExe()]);
    expect(stderr).not.toContain("error:");
    expect(await bytesOf(String(dir), "package.json")).toBe(
      '{\n  "name": "app",\n  "dependencies": {\n    "dep": "./caf\xE9/dep"\n  }\n}\n',
    );
    expect(await Bun.file(join(String(dir), "node_modules", "dep", "package.json")).json()).toEqual({
      name: "dep",
      version: "1.0.0",
    });
    expect(exitCode).toBe(0);
  });

  test("bun pm pack puts the bytes that it read into the tarball", async () => {
    using dir = tempDir("package-json-not-utf8", { "package.json": Buffer.from(manifest, "latin1") });
    const { stderr, exitCode } = await bun(String(dir), "pm", "pack");
    expect(stderr).not.toContain("error:");
    const tar = Buffer.from(Bun.gunzipSync(await Bun.file(join(String(dir), "app-1.0.0.tgz")).bytes()));
    // The tarball starts with the header of its first file, which has the size of the file in octal at byte 124,
    // and the file starts at byte 512.
    const size = parseInt(tar.toString("latin1", 124, 135), 8);
    expect({ name: tar.toString("latin1", 0, 20), contents: tar.toString("latin1", 512, 512 + size) }).toEqual({
      name: "package/package.json",
      contents: manifest,
    });
    expect(exitCode).toBe(0);
  });

  // 0xE2 0x82 is the start of a sequence that `A` does not go on with: one U+FFFD, as TextDecoder reads it.
  test("bun.lock has U+FFFD for the start of a sequence that does not go on", async () => {
    const root = `{"name":"app-\xE2\x82A-caf\xE9","workspaces":["packages/*"],"dependencies":{"a":"workspace:*"}}`;
    using dir = tempDir("package-json-not-utf8", {
      "package.json": Buffer.from(root, "latin1"),
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    });
    const { stderr, exitCode } = await bun(String(dir), "install", "--lockfile-only");
    expect(stderr).not.toContain("error:");
    const lock = await bytesOf(String(dir), "bun.lock");
    expect(/"name": "(.*)",/.exec(lock)?.[1]).toBe(bytesOfText("app-\uFFFDA-caf\uFFFD"));
    expect(exitCode).toBe(0);
  });
});
