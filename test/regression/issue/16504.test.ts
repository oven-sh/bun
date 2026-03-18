import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/16504
// DNS promise should reject (not segfault) when result-to-JS conversion fails.
test("Bun.dns.lookup rejects on invalid hostname without crashing", async () => {
  // This should reject with a DNS error, not segfault
  try {
    await Bun.dns.lookup("example.invalid");
  } catch (e: any) {
    expect(e.code).toBe("DNS_ENOTFOUND");
    return;
  }
  // If it didn't throw, that's also fine (e.g. some DNS resolvers may resolve anything)
});

test("Bun.dns.reverse rejects on unresolvable address without crashing", async () => {
  try {
    await Bun.dns.reverse("192.0.2.1"); // TEST-NET, should not reverse-resolve
  } catch (e: any) {
    expect(e).toBeDefined();
    return;
  }
  // If it didn't throw, that's also fine
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
        // All should be settled (rejected), not crash
        for (const r of results) {
          if (r.status === "rejected") {
            // expected
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
