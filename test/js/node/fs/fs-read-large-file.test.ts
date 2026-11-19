import { expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, writeSync } from "fs";
import { bunEnv, bunExe, isLinux, isRoot, libcPathForDlopen, tempDir } from "harness";
import { join } from "path";

function writeLargeFile(path: string, blocks: number, tail: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  const block = Buffer.alloc(1 << 20);
  const fd = openSync(path, "w");
  for (let index = 0; index < blocks; index++) {
    block.fill(index + 1);
    block.writeUInt32LE((index * 2654435761) >>> 0, 12345);
    writeSync(fd, block);
    hasher.update(block);
  }
  writeSync(fd, tail);
  hasher.update(tail);
  closeSync(fd);
  return { size: blocks * block.length + tail.length, digest: hasher.digest("hex") };
}

test("readFileSync reads every byte of a file over 64 MB", () => {
  using dir = tempDir("read-large-file", {});
  const path = join(String(dir), "large.bin");
  const { size, digest } = writeLargeFile(path, 97, "tail");
  const bytes = readFileSync(path);
  expect(bytes.length).toBe(size);
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(digest);
});

test("readFileSync decodes a file over 64 MB", () => {
  using dir = tempDir("read-large-file", {});
  const path = join(String(dir), "large.txt");
  const { size } = writeLargeFile(path, 65, "the end");
  const text = readFileSync(path, "latin1");
  expect(text.length).toBe(size);
  expect(text.endsWith("the end")).toBe(true);
});

// The limit on threads and processes of a user is lowered around each call alone, behind the start of the threads that
// fs.promises and the collector use.
const readWithoutNewThreads = `
import { dlopen, ptr } from "bun:ffi";
import { promises, readFileSync } from "fs";

const [path, libc] = process.argv.slice(2);
const { symbols } = dlopen(libc, {
  getrlimit: { args: ["int", "ptr"], returns: "int" },
  setrlimit: { args: ["int", "ptr"], returns: "int" },
});
const RLIMIT_NPROC = 6;
const limit = new BigUint64Array(2);
symbols.getrlimit(RLIMIT_NPROC, ptr(limit));
const [soft] = limit;
async function withoutNewThreads(run) {
  limit[0] = 1n;
  symbols.setrlimit(RLIMIT_NPROC, ptr(limit));
  try {
    return await run();
  } finally {
    limit[0] = soft;
    symbols.setrlimit(RLIMIT_NPROC, ptr(limit));
  }
}
function startsAProcess() {
  try {
    Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"] });
    return true;
  } catch {
    return false;
  }
}
const digest = bytes => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
await promises.readFile(import.meta.path);
Bun.gc(true);
console.log(
  JSON.stringify({
    startsAProcess: await withoutNewThreads(startsAProcess),
    sync: digest(await withoutNewThreads(() => readFileSync(path))),
    async: digest(await withoutNewThreads(() => promises.readFile(path))),
  }),
);
`;

test.skipIf(!isLinux)("a file over 64 MB is read where the system starts no more threads", async () => {
  using dir = tempDir("read-large-file", { "read.mjs": readWithoutNewThreads });
  const path = join(String(dir), "large.bin");
  const { digest } = writeLargeFile(path, 97, "tail");
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "read.mjs"), path, libcPathForDlopen()],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { startsAProcess, ...digests } = JSON.parse(stdout);
  expect(digests).toEqual({ sync: digest, async: digest });
  // The limit does not hold for root.
  if (!isRoot) expect(startsAProcess).toBe(false);
  expect(exitCode).toBe(0);
});
