import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29533
// random-number-csprng does this when it loads: bluebird's promisifyAll(require("crypto")), then randomBytesAsync().
// In bun, bluebird reads each enumerable key of each class prototype, and a getter that throws there stops the load.
test("bluebird promisifyAll(require('crypto')) does not throw", async () => {
  // In a child: promisifyAll adds methods to node:crypto and its classes.
  const script = `
    const Bluebird = require(${JSON.stringify(Bun.resolveSync("bluebird", import.meta.dir))});
    const crypto = Bluebird.promisifyAll(require("crypto"));
    crypto.randomBytesAsync(8).then(bytes => console.log(bytes.length));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "8\n", stderr: "", exitCode: 0 });
});
