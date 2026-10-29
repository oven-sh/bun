// Temporary measurement, removed before this change is ready. Windows only.
// Each test prints one "MEASURE" line to the log: what one operation added to a fresh bun process.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, preadExact, tempDirWithFiles } from "harness";
import { closeSync, copyFileSync, openSync, writeSync } from "node:fs";
import { basename, join } from "node:path";

const fixture = join(import.meta.dir, "libuv-threadpool-stack-measure-fixture.ts");

/** PE32+: the file offset of SizeOfStackReserve in the optional header. SizeOfStackCommit follows it. */
function stackSizesOffset(fd: number): number {
  const dos = preadExact(fd, 0, 64);
  if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
  const peOff = dos.readUInt32LE(60);
  if (preadExact(fd, peOff, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");
  const optional = peOff + 4 + 20;
  if (preadExact(fd, optional, 2).readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
  return optional + 72;
}

function stackSizes(path: string): { reserve: number; commit: number } {
  const fd = openSync(path, "r");
  try {
    const sizes = preadExact(fd, stackSizesOffset(fd), 16);
    return { reserve: Number(sizes.readBigUInt64LE(0)), commit: Number(sizes.readBigUInt64LE(8)) };
  } finally {
    closeSync(fd);
  }
}

let onePageCopy: string | undefined;
/** A copy of bun.exe whose header commits one page of stack for a thread, the way oven-sh/bun#45094 links it. */
function copyWithOnePageStackCommit(): string {
  if (onePageCopy) return onePageCopy;
  const copy = join(tempDirWithFiles("libuv-pool-one-page", {}), basename(bunExe()));
  copyFileSync(bunExe(), copy);
  const fd = openSync(copy, "r+");
  try {
    const commit = Buffer.alloc(8);
    commit.writeBigUInt64LE(0x1000n);
    writeSync(fd, commit, 0, 8, stackSizesOffset(fd) + 8);
  } finally {
    closeSync(fd);
  }
  return (onePageCopy = copy);
}

async function measure(exe: string, name: string, poolSize: number | undefined) {
  const dir = tempDirWithFiles("libuv-pool-measure", { "data.txt": "data", "module.mjs": "export default 1;" });
  await using proc = Bun.spawn({
    cmd: [exe, fixture, name, dir],
    env: { ...bunEnv, UV_THREADPOOL_SIZE: poolSize === undefined ? undefined : String(poolSize) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: unknown = stdout;
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, stderr, exitCode };
}

describe.skipIf(!isWindows)("libuv pool measurements (temporary)", () => {
  test("stack sizes in the header of bun.exe", () => {
    console.log("MEASURE header", JSON.stringify({ exe: basename(bunExe()), ...stackSizes(bunExe()) }));
    console.log(
      "MEASURE header",
      JSON.stringify({ exe: "one page copy", ...stackSizes(copyWithOnePageStackCommit()) }),
    );
  }, 60_000);

  // What the start of the pool costs, with the header of this build and with one page of stack commit in it.
  for (const header of ["as built", "one page"] as const) {
    for (const poolSize of [undefined, 32]) {
      for (const run of [1, 2, 3]) {
        test(`pool start: header ${header}, UV_THREADPOOL_SIZE ${poolSize ?? "not set"}, run ${run}`, async () => {
          const exe = header === "one page" ? copyWithOnePageStackCommit() : bunExe();
          const measured = await measure(exe, "fs.statfs-callback", poolSize);
          console.log("MEASURE pool-start", JSON.stringify({ header, poolSize: poolSize ?? null, run, ...measured }));
          expect(measured.exitCode).toBe(0);
        }, 60_000);
      }
    }
  }

  // Which calls start the pool. With 24 threads in it, a call that starts it adds at least 24 threads.
  for (const name of [
    "nothing",
    "fs.statfs-callback",
    "fs.stat-callback",
    "fs.promises.stat",
    "fs.promises.readFile",
    "fs.promises.writeFile",
    "fs.promises.readdir",
    "fs.promises.open-close",
    "fs.createReadStream",
    "fs.createWriteStream",
    "Bun.file.text",
    "Bun.write",
    "Bun.file.writer",
    "Bun.shell-echo",
    "Bun.shell-echo-redirect",
    "dns.lookup-localhost",
    "Bun.spawn",
    "import-file",
  ]) {
    test(`first use: ${name}`, async () => {
      const measured = await measure(bunExe(), name, 24);
      console.log("MEASURE first-use", JSON.stringify(measured));
      expect(measured.exitCode).toBe(0);
    }, 60_000);
  }
});
