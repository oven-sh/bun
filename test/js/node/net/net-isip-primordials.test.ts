import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// net.isIP() (also the "is this already an address?" check in dns.lookup) must
// not consult the user-visible RegExp.prototype.test: a patched test() would
// make dns.lookup hand the hostname back as the resolved address.
test("net.isIP and dns.lookup ignore a patched RegExp.prototype.test", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const net = require("net");
      const dns = require("dns");
      const origTest = RegExp.prototype.test;
      RegExp.prototype.test = function (s) {
        return !origTest.call(this, s);
      };
      const classified = {
        v4: net.isIP("127.0.0.1"),
        v6: net.isIP("::1"),
        host: net.isIP("localhost"),
        isIPv4: net.isIPv4("10.0.0.1"),
        isIPv6: net.isIPv6("fe80::1%lo0"),
      };
      dns.lookup("localhost", { family: 4 }, (err, address, family) => {
        RegExp.prototype.test = origTest;
        console.log(JSON.stringify({ classified, err: err?.code ?? null, address, family }));
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  expect(result.classified).toEqual({ v4: 4, v6: 6, host: 0, isIPv4: true, isIPv6: true });
  // The resolver answers, not the patched classifier echoing the hostname back.
  expect(result.err).toBeNull();
  expect(result.address).not.toBe("localhost");
  expect(result.family).toBe(4);
  expect(exitCode).toBe(0);
});
