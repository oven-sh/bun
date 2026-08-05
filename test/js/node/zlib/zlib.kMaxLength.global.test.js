import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// zlib captures buffer.kMaxLength when the module is first loaded (same as
// Node), so it must be patched before the first require("node:zlib") in the
// process. Another test file running in this process may have loaded node:zlib
// already, so each check runs in a fresh child process instead.
const fixture = join(import.meta.dir, "zlib-kmaxlength-fixture.cjs");

const data = {
  brotli: ["1b7f00f825c222b1402003", "brotliDecompress", "brotliDecompressSync"],
  inflate: ["789c4b4c1c58000039743081", "inflate", "inflateSync"],
  gunzip: ["1f8b08000000000000034b4c1c5800008c362bf180000000", "gunzip", "gunzipSync"],
  unzip: ["1f8b08000000000000034b4c1c5800008c362bf180000000", "unzip", "unzipSync"],
};

for (const method in data) {
  const [encodedHex, asyncName, syncName] = data[method];

  it.concurrent(`decompress ${method} beyond kMaxLength throws RangeError (sync and async)`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, encodedHex, asyncName, syncName],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
}
