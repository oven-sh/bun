// Verifies async fs.read/fs.write behaviour is unchanged when routed through
// the Windows I/O Ring backend (BUN_FEATURE_FLAG_WINDOWS_IORING=1). On other
// platforms and older Windows the flag is a no-op, so these assertions also
// serve as a regression check that enabling the flag never changes results.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const script = /* js */ `
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

async function main() {
  const dir = process.argv[2];
  const N = 64;
  const size = 4096;

  // write N files concurrently via fs.promises.open + write
  const names = [];
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const p = path.join(dir, "f" + i + ".bin");
      names.push(p);
      const fh = await fsp.open(p, "w");
      const buf = Buffer.alloc(size, i & 0xff);
      const { bytesWritten } = await fh.write(buf, 0, size, 0);
      if (bytesWritten !== size) throw new Error("short write " + bytesWritten);
      await fh.close();
    }),
  );

  // read them back concurrently via fs.promises.open + read
  await Promise.all(
    names.map(async (p, i) => {
      const fh = await fsp.open(p, "r");
      const buf = Buffer.alloc(size);
      const { bytesRead } = await fh.read(buf, 0, size, 0);
      if (bytesRead !== size) throw new Error("short read " + bytesRead);
      for (let j = 0; j < size; j++) {
        if (buf[j] !== (i & 0xff)) throw new Error("data mismatch at " + p);
      }
      await fh.close();
    }),
  );

  // callback API with current-position (no offset)
  await new Promise((resolve, reject) => {
    fs.open(names[0], "r", (err, fd) => {
      if (err) return reject(err);
      const buf = Buffer.alloc(size);
      fs.read(fd, buf, 0, size, null, (err, n) => {
        if (err) return reject(err);
        if (n !== size) return reject(new Error("cb short read " + n));
        fs.close(fd, () => resolve());
      });
    });
  });

  // error path: read from a closed fd
  let errCode = "";
  try {
    const fh = await fsp.open(names[0], "r");
    await fh.close();
    await fh.read(Buffer.alloc(16), 0, 16, 0);
  } catch (e) {
    errCode = e.code || e.name;
  }
  if (errCode !== "EBADF") throw new Error("expected EBADF, got " + errCode);

  console.log("OK " + N);
}
main().catch(e => { console.error(e); process.exit(1); });
`;

async function run(withFlag: boolean) {
  using dir = tempDir("fs-ioring", { "run.js": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js", String(dir)],
    env: {
      ...bunEnv,
      ...(withFlag ? { BUN_FEATURE_FLAG_WINDOWS_IORING: "1" } : {}),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe("fs async read/write with BUN_FEATURE_FLAG_WINDOWS_IORING", () => {
  test("flag off (baseline)", async () => {
    const { stdout, stderr, exitCode } = await run(false);
    expect(stderr).toBe("");
    expect(stdout).toBe("OK 64");
    expect(exitCode).toBe(0);
  });

  test("flag on", async () => {
    const { stdout, stderr, exitCode } = await run(true);
    expect(stderr).toBe("");
    expect(stdout).toBe("OK 64");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("flag on and off produce identical output on Windows", async () => {
    const [a, b] = await Promise.all([run(false), run(true)]);
    expect(b.stdout).toBe(a.stdout);
    expect(b.exitCode).toBe(a.exitCode);
  });
});
