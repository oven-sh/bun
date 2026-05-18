import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A `/0` ("match all") subnet is valid Node input, but the mask formula
// computed `0 << <bits>`, which the debug build's overflow-checks abort on
// (uncatchable) — on every `check()`, including the per-connection hot path
// (`net.createServer({ blockList })`). A `/0` mask is 0, so every address
// matches. Run in a subprocess since the failure was a hard abort.
test("BlockList /0 subnet matches all addresses without aborting", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { BlockList } = require("net");
       const v4 = new BlockList(); v4.addSubnet("0.0.0.0", 0, "ipv4");
       const v6 = new BlockList(); v6.addSubnet("::", 0, "ipv6");
       process.stdout.write(JSON.stringify([
         v4.check("1.2.3.4"),
         v4.check("255.255.255.255"),
         v6.check("2001:db8::1", "ipv6"),
       ]));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("[true,true,true]");
  expect(exitCode).toBe(0);
});
