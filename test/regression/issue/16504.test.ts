import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/16504
// DNS promise should reject (not segfault) when result-to-JS conversion fails.
test("Bun.dns.lookup rejects on invalid hostname without crashing", async () => {
  // This should reject with a DNS error, not segfault
  expect(async () => {
    await Bun.dns.lookup("example.invalid");
  }).toThrow();
});

test("Bun.dns.reverse rejects on unresolvable address without crashing", async () => {
  expect(async () => {
    await Bun.dns.reverse("192.0.2.1"); // TEST-NET, should not reverse-resolve
  }).toThrow();
});

test("dns operations do not crash when result conversion could fail", async () => {
  // Spawns a subprocess to catch segfaults as a non-zero exit code
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function main() {
        const results = await Promise.allSettled([
          Bun.dns.lookup("example.invalid"),
          Bun.dns.reverse("192.0.2.1"),
          Bun.dns.lookup("this-domain-does-not-exist.invalid"),
        ]);
        for (const r of results) {
          if (r.status !== "rejected") {
            throw new Error("expected rejection, got: " + r.status);
          }
        }
        console.log("OK");
      }
      main();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
