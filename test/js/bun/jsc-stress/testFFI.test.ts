import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync } from "fs";
import { isASAN, isDebug, isFreeBSD, isLinux, isMacOS, isMusl, isWindows, tmpdirSync } from "harness";
import path from "path";

const binaryName = isWindows ? "testFFI.exe" : "testFFI";

function localCandidates(): string[] {
  const out: string[] = [];
  const explicit = process.env.BUN_TESTFFI_PATH;
  if (explicit) out.push(explicit);
  const roots = [
    process.env.BUN_WEBKIT_PATH,
    path.join(import.meta.dir, "../../../../build/debug-local/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/release-local/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/debug/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/release/deps/WebKit"),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    out.push(path.join(root, "bin", binaryName));
    out.push(path.join(root, "WebKitBuild/Release/bin", binaryName));
    out.push(path.join(root, "WebKitBuild/Debug/bin", binaryName));
  }
  return out;
}

function releaseTag(): string | null {
  const webkit = process.versions.webkit;
  if (!webkit || !/^preview-pr-\d+-[0-9a-f]+$|^[0-9a-f]{7,40}$/.test(webkit)) return null;
  return webkit.startsWith("preview-pr-") ? `autobuild-${webkit}` : `autobuild-${webkit}`;
}

function assetCandidates(): string[] {
  let os: string;
  if (isMacOS) os = "macos";
  else if (isWindows) os = "windows";
  else if (isFreeBSD) os = "freebsd";
  else if (isLinux) os = "linux";
  else return [];
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const base = isMusl ? `${os}-${arch}-musl` : `${os}-${arch}`;
  const suffixes =
    isDebug && isASAN
      ? ["-debug-asan", "-asan", "-debug", ""]
      : isASAN
        ? ["-asan", ""]
        : isDebug
          ? ["-debug", ""]
          : ["", "-lto"];
  const ext = isWindows ? ".exe" : "";
  return suffixes.map(s => `testFFI-${base}${s}${ext}`);
}

async function downloadTestFFI(): Promise<string | null> {
  const tag = releaseTag();
  if (!tag) return null;
  const cacheDir = path.join(tmpdirSync(), "testFFI");
  mkdirSync(cacheDir, { recursive: true });
  for (const asset of assetCandidates()) {
    const url = `https://github.com/oven-sh/WebKit/releases/download/${tag}/${asset}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) continue;
    const dest = path.join(cacheDir, isWindows ? "testFFI.exe" : "testFFI");
    await Bun.write(dest, response);
    if (!isWindows) chmodSync(dest, 0o755);
    return dest;
  }
  return null;
}

async function findTestFFI(): Promise<string | null> {
  for (const candidate of localCandidates()) if (existsSync(candidate)) return candidate;
  return await downloadTestFFI();
}

const testFFI = await findTestFFI();

test.skipIf(!testFFI)(
  "testFFI (JavaScriptCore FFI C++/ABI checks)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [testFFI!],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;
    if (exitCode !== 0 || !/OK: \d+ checks passed, 0 failed\./.test(output)) {
      console.log(output);
    }
    expect(exitCode).toBe(0);
    expect(output).toMatch(/OK: \d+ checks passed, 0 failed\./);
  },
  300_000,
);
