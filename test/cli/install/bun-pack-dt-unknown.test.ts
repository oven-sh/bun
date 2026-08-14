// Some filesystems (FUSE, NFS, XFS formatted with ftype=0) do not fill in
// d_type, so every readdir entry comes back as DT_UNKNOWN. `bun pm pack` and
// `bun publish` must still pack those entries. A FUSE mount needs /dev/fuse, so
// instead an LD_PRELOAD shim zeroes d_type in every getdents64 record: bun
// issues getdents64 through libc's syscall(2) wrapper, which the shim
// interposes. The shim announces itself on stderr the first time it rewrites a
// record so the tests can tell that bun's readdir actually went through it
// (if bun ever stops using the libc wrapper, this file needs a real DT_UNKNOWN
// filesystem instead of silently passing).
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_MARKER = "dt-unknown-shim: rewrote getdents64 d_type";

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdint.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*real_syscall)(long, long, long, long, long, long, long);
static int announced;

long syscall(long number, ...) {
  va_list ap;
  long a, b, c, d, e, f;
  va_start(ap, number);
  a = va_arg(ap, long);
  b = va_arg(ap, long);
  c = va_arg(ap, long);
  d = va_arg(ap, long);
  e = va_arg(ap, long);
  f = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall) {
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
  }
  long rc = real_syscall(number, a, b, c, d, e, f);
  if (number != SYS_getdents64 || rc <= 0) return rc;
  if (!announced) {
    announced = 1;
    static const char marker[] = "${SHIM_MARKER}\\n";
    if (write(2, marker, sizeof(marker) - 1) < 0) {}
  }
  // struct linux_dirent64 { u64 d_ino; s64 d_off; u16 d_reclen; u8 d_type; char d_name[]; }
  unsigned char *buf = (unsigned char *)b;
  for (long off = 0; off + 19 <= rc;) {
    uint16_t reclen;
    memcpy(&reclen, buf + off + 16, sizeof(reclen));
    if (reclen == 0) break;
    buf[off + 18] = 0; /* DT_UNKNOWN */
    off += reclen;
  }
  return rc;
}
`;

let shimDir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  shimDir = tempDir("dt-unknown-shim", { "shim.c": SHIM_C });
  shimPath = join(String(shimDir), "shim.so");
  await using proc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`shim compile failed: ${stderr || stdout}`);
  }
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

function shimEnv() {
  return { ...bunEnv, LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath };
}

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: shimEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(SHIM_MARKER);
  expect({ stdout, stderr, exitCode }).toMatchObject({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
}

function packedPaths(tarball: string): string[] {
  return readTarball(tarball)
    .entries.map((entry: { pathname: string }) => entry.pathname)
    .sort();
}

describe.skipIf(!isLinux || !cc)("pack on a filesystem whose readdir reports DT_UNKNOWN", () => {
  test.concurrent("packs the project tree", async () => {
    using dir = tempDir("dt-unknown-tree", {
      "package.json": JSON.stringify({ name: "dt-unknown-tree", version: "1.0.0" }),
      "index.js": "",
      "lib/a.js": "",
      "lib/nested/b.js": "",
      // `out/` only ignores directories, so it needs the entry's kind: the
      // `out` directory is ignored, the `lib/out` file is not.
      ".npmignore": "out/\n",
      "out/c.js": "",
      "lib/out": "",
    });
    // Symlinks are never packed; resolving the kind with lstat has to keep that.
    await symlink("index.js", join(String(dir), "link.js"));

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-tree-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/lib/a.js",
      "package/lib/nested/b.js",
      "package/lib/out",
      "package/package.json",
    ]);
  });

  test.concurrent('packs what "files" selects', async () => {
    using dir = tempDir("dt-unknown-files", {
      "package.json": JSON.stringify({
        name: "dt-unknown-files",
        version: "1.0.0",
        files: ["index.js", "lib", "!lib/internal/"],
      }),
      "index.js": "",
      "excluded.js": "",
      "lib/a.js": "",
      "lib/nested/b.js": "",
      "lib/internal/c.js": "",
    });
    await symlink("a.js", join(String(dir), "lib", "link.js"));

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-files-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/lib/a.js",
      "package/lib/nested/b.js",
      "package/package.json",
    ]);
  });

  test.concurrent("packs bundledDependencies", async () => {
    using dir = tempDir("dt-unknown-bundled", {
      "package.json": JSON.stringify({
        name: "dt-unknown-bundled",
        version: "1.0.0",
        dependencies: { "dep": "1.0.0", "@scope/dep": "1.0.0", "not-bundled": "1.0.0" },
        bundledDependencies: ["dep", "@scope/dep"],
      }),
      "index.js": "",
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/lib/index.js": "",
      "node_modules/@scope/dep/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }),
      "node_modules/@scope/dep/index.js": "",
      "node_modules/not-bundled/package.json": JSON.stringify({ name: "not-bundled", version: "1.0.0" }),
    });

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-bundled-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/node_modules/@scope/dep/index.js",
      "package/node_modules/@scope/dep/package.json",
      "package/node_modules/dep/lib/index.js",
      "package/node_modules/dep/package.json",
      "package/package.json",
    ]);
  });

  test.concurrent('publish packs the tree, walks "directories.bin" and finds the readme', async () => {
    let captured: any;
    using registry = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK");
      },
    });
    using dir = tempDir("dt-unknown-publish", {
      "bunfig.toml": Bun.TOML.stringify({
        install: { cache: false, registry: { url: `http://localhost:${registry.port}`, token: "unused" } },
      }),
      "package.json": JSON.stringify({
        name: "dt-unknown-publish",
        version: "1.0.0",
        directories: { bin: "bins" },
      }),
      "README.md": "# dt-unknown-publish",
      "index.js": "",
      "bins/a.js": "",
      "bins/more/b.js": "",
    });

    await run(String(dir), "publish");

    expect(captured.versions["1.0.0"]).toMatchObject({
      bin: { "a.js": "bins/a.js", "more": "bins/more", "b.js": "bins/more/b.js" },
      readme: "# dt-unknown-publish",
      readmeFilename: "README.md",
    });

    const attachment: { data: string } = Object.values(captured._attachments)[0] as any;
    const tarball = join(String(dir), "published.tgz");
    await writeFile(tarball, Buffer.from(attachment.data, "base64"));
    expect(packedPaths(tarball)).toEqual([
      "package/README.md",
      "package/bins/a.js",
      "package/bins/more/b.js",
      "package/index.js",
      "package/package.json",
    ]);
  });
});
