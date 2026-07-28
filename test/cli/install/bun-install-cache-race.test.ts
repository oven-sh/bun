// Concurrent `bun install` processes sharing BUN_INSTALL_CACHE_DIR on a
// filesystem without renameat2(RENAME_EXCHANGE) (NFS, FUSE) raced: when a
// process lost the RENAME_NOREPLACE race for a cache entry, the fallback
// deleted the existing entry in place before renaming its own copy over it.
// A concurrent reader copying that entry into node_modules would open the
// directory fine and then hit ENOENT on files mid-copy (issue #36227).
//
// An LD_PRELOAD shim makes RENAME_EXCHANGE fail with EOPNOTSUPP the way NFS
// does; everything else runs against the real (local) filesystem.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

setDefaultTimeout(1000 * 60 * 5);

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// BUN_TEST_FAIL_RENAME_EXCHANGE=1: renameat2 with RENAME_EXCHANGE fails with
// EOPNOTSUPP (NFS behavior). Covers both the glibc wrapper and the raw
// syscall() path bun uses on Linux.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <sys/syscall.h>

#define RENAME_EXCHANGE_FLAG (1 << 1)

static long (*real_syscall)(long, ...);
static int fail_exchange = -1;

static int should_fail(void) {
  if (fail_exchange < 0) fail_exchange = getenv("BUN_TEST_FAIL_RENAME_EXCHANGE") != NULL;
  return fail_exchange;
}

long syscall(long number, ...) {
  if (!real_syscall) real_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  va_list ap;
  va_start(ap, number);
  long a = va_arg(ap, long);
  long b = va_arg(ap, long);
  long c = va_arg(ap, long);
  long d = va_arg(ap, long);
  long e = va_arg(ap, long);
  long f = va_arg(ap, long);
  va_end(ap);
  if (number == SYS_renameat2 && (e & RENAME_EXCHANGE_FLAG) && should_fail()) {
    errno = EOPNOTSUPP;
    return -1;
  }
  return real_syscall(number, a, b, c, d, e, f);
}

int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags) {
  if ((flags & RENAME_EXCHANGE_FLAG) && should_fail()) {
    errno = EOPNOTSUPP;
    return -1;
  }
  return (int)syscall(SYS_renameat2, (long)olddirfd, (long)oldpath, (long)newdirfd, (long)newpath, (long)flags);
}
`;

// -------------------------------------------------------------------
// Tarball construction. Built in-process so the package can have many
// files (a wide delete/copy window) without committing a fixture.
// -------------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name: string, size: number): Buffer {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100); // mode
  buf.write(octal(0, 8), 108); // uid
  buf.write(octal(0, 8), 116); // gid
  buf.write(octal(size, 12), 124); // size
  buf.write(octal(0, 12), 136); // mtime
  buf.fill(" ", 148, 156); // checksum placeholder
  buf.write("0", 156); // regular file
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 8), 148);
  return buf;
}

function pad512(len: number): Buffer {
  const pad = (512 - (len % 512)) % 512;
  return Buffer.alloc(pad, 0);
}

const PKG_NAME = "cache-race-pkg";
const FILE_COUNT = 600;

function buildTarball(): { tgz: Buffer; shasum: string; integrity: string } {
  const blocks: Buffer[] = [];
  const push = (path: string, body: Buffer) => {
    blocks.push(tarHeader(`package/${path}`, body.length), body, pad512(body.length));
  };
  push("package.json", Buffer.from(JSON.stringify({ name: PKG_NAME, version: "1.0.0", main: "index.js" }) + "\n"));
  push("index.js", Buffer.from("module.exports = 'ok';\n"));
  for (let i = 0; i < FILE_COUNT; i++) {
    push(`files/f-${i}.txt`, Buffer.from(`file ${i}\n`));
  }
  blocks.push(Buffer.alloc(1024, 0)); // end-of-archive
  const tgz = gzipSync(Buffer.concat(blocks));
  return {
    tgz,
    shasum: createHash("sha1").update(tgz).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
  };
}

async function makeRegistry(tgz: Buffer, shasum: string, integrity: string) {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    if (url.pathname === `/${PKG_NAME}`) {
      const body = JSON.stringify({
        name: PKG_NAME,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: PKG_NAME,
            version: "1.0.0",
            dist: {
              shasum,
              integrity,
              tarball: `http://127.0.0.1:${port}/${PKG_NAME}/-/${PKG_NAME}-1.0.0.tgz`,
            },
          },
        },
      });
      res.setHeader("content-type", "application/json");
      res.end(body);
      return;
    }
    if (url.pathname.endsWith(".tgz")) {
      res.setHeader("content-type", "application/octet-stream");
      res.end(tgz);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

let shimPath: string;
let shimDir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  shimDir = tempDir("cache-race-shim", { "shim.c": SHIM_C });
  shimPath = join(String(shimDir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

test.skipIf(!isLinux || !cc)(
  "concurrent installs sharing a cache survive a filesystem without RENAME_EXCHANGE",
  async () => {
    const { tgz, shasum, integrity } = buildTarball();
    await using registry = await makeRegistry(tgz, shasum, integrity);

    const PROCS = 4;
    const ITERATIONS = 3;
    const existingPreload = bunEnv.LD_PRELOAD;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const projects: Record<string, string> = {};
      for (let i = 0; i < PROCS; i++) {
        projects[`proj-${i}/package.json`] = JSON.stringify({
          name: `proj-${i}`,
          version: "1.0.0",
          dependencies: { [PKG_NAME]: "1.0.0" },
        });
        projects[`proj-${i}/bunfig.toml`] = `[install]\nregistry = "${registry.url}"\n`;
      }
      using dir = tempDir(`cache-race-${iter}`, projects);
      const cacheDir = join(String(dir), ".shared-cache");

      const procs = Array.from({ length: PROCS }, (_, i) =>
        Bun.spawn({
          cmd: [bunExe(), "install", "--backend=copyfile", "--linker=hoisted", "--no-progress"],
          cwd: join(String(dir), `proj-${i}`),
          env: {
            ...bunEnv,
            BUN_INSTALL_CACHE_DIR: cacheDir,
            LD_PRELOAD: existingPreload ? `${shimPath}:${existingPreload}` : shimPath,
            BUN_TEST_FAIL_RENAME_EXCHANGE: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      const results = await Promise.all(
        procs.map(async proc => {
          const [stdout, stderr, exitCode] = await Promise.all([
            proc.stdout.text(),
            proc.stderr.text(),
            proc.exited,
          ]);
          return { stdout, stderr, exitCode };
        }),
      );

      for (let i = 0; i < results.length; i++) {
        const { stdout, stderr, exitCode } = results[i];
        const output = `iteration ${iter} proj-${i}:\n${stdout}\n${stderr}`;
        expect(output).not.toContain("ENOENT");
        expect(exitCode).toBe(0);
      }
    }
  },
);
