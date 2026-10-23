// An LD_PRELOAD shim makes every inotify_add_watch fail with ENOSPC (what the
// kernel returns when fs.inotify.max_user_watches is exhausted). The watcher
// has to tell the user that it cannot watch. Without the warning, `bun --hot`
// and the dev server start normally and never reload, with no message.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#include <errno.h>
int inotify_add_watch(int fd, const char *path, unsigned int mask) {
    (void)fd; (void)path; (void)mask;
    errno = ENOSPC;
    return -1;
}
`;

const SERVE_FIXTURE = /* js */ `
import page from "./index.html";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: true,
  routes: { "/": page },
});
// The route is bundled, and its files watched, on the first request.
await fetch("http://127.0.0.1:" + server.port + "/");
console.log("served");
process.exit(0);
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("watch-add-fail", {
    "shim.c": SHIM_C,
    "hot.js": `console.log("ran"); process.exit(0);`,
    "index.html": `<script type="module" src="./app.ts"></script>`,
    "app.ts": `console.log("app");`,
    "serve.js": SERVE_FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runWithShim(args: string[]) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.skipIf(!isLinux || !cc)("bun --hot warns when inotify_add_watch fails", async () => {
  const { stdout, stderr, exitCode } = await runWithShim(["--hot", "hot.js"]);
  expect(stdout).toBe("ran\n");
  expect(stderr).toContain("ENOSPC");
  expect(stderr).toContain("Bun cannot watch this path");
  expect(stderr).toContain("fs.inotify.max_user_watches");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isLinux || !cc)("the dev server warns when inotify_add_watch fails", async () => {
  const { stdout, stderr, exitCode } = await runWithShim(["serve.js"]);
  expect(stdout).toContain("served");
  expect(stderr).toContain("ENOSPC");
  expect(stderr).toContain("Bun cannot watch this path");
  expect(exitCode).toBe(0);
});
