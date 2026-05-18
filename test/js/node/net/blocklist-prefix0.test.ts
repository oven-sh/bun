import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A `/0` ("match all") subnet is valid Node input, but the mask formula
// computed `0 << <bits>`, which the debug build's overflow-checks abort on
// (uncatchable) — on every `check()`, including the per-connection hot path
// (`net.createServer({ blockList })`). A `/0` mask is 0, so every address
// matches. Run in a subprocess since the failure was a hard abort.
test.concurrent("BlockList /0 subnet matches all addresses without aborting", async () => {
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const cleanedStderr = stderr
    .split("\n")
    .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(cleanedStderr).toBe("");
  expect(stdout).toBe("[true,true,true]");
  expect(exitCode).toBe(0);
});

// `as_v4()` extracts the low 32 bits of an IPv4-mapped IPv6 network
// (`::ffff:a.b.c.d`), but its `prefix` was validated against [0,128] for the
// 128-bit form — feeding that straight into the 32-bit mask formula hit the
// same shift-left / subtract overflow abort in debug (and a garbage mask in
// release). The prefix must be translated (`saturating_sub(96)`) so `/104`
// behaves as IPv4 `/8` like Node.
test.concurrent("BlockList IPv4-mapped IPv6 subnet translates prefix without aborting", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { BlockList } = require("net");
       const bl = new BlockList(); bl.addSubnet("::ffff:10.0.0.0", 104, "ipv6");
       const bl128 = new BlockList(); bl128.addSubnet("::ffff:1.2.3.4", 128, "ipv6");
       process.stdout.write(JSON.stringify([
         bl.check("10.1.2.3"),
         bl.check("11.1.2.3"),
         bl128.check("1.2.3.4"),
         bl128.check("1.2.3.5"),
       ]));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const cleanedStderr = stderr
    .split("\n")
    .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(cleanedStderr).toBe("");
  expect(stdout).toBe("[true,false,true,false]");
  expect(exitCode).toBe(0);
});
