import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// The c-ares channel used by dns.resolve* / dns.reverse / Bun.dns reads the
// system nameserver list once at creation and never again, so after a network
// change (VPN connect, Wi-Fi switch, DHCP renew) lookups would keep hitting
// the boot-time servers. These tests exercise the config-change generation
// counter and the OS watcher that drives it.

async function run(src: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, ...extraEnv },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }, stderr).toEqual({ stdout: "PASS", exitCode: 0 });
}

test("dns resolver re-initializes after a config-change signal", async () => {
  await run(`
    const dns = require("node:dns");
    const { dnsConfigChanged, dnsConfigGeneration } = require("bun:internal-for-testing");

    // Force channel creation and capture the system default server list.
    const before = dns.getServers();
    if (!Array.isArray(before) || before.length === 0) {
      throw new Error("expected at least one system DNS server");
    }
    const g0 = dnsConfigGeneration();

    // Simulate a network-config change.
    dnsConfigChanged();
    const g1 = dnsConfigGeneration();
    if (g1 !== g0 + 1) {
      throw new Error("generation did not advance: " + g0 + " -> " + g1);
    }

    // Next access must recreate the channel from current system config without
    // crashing; the server list should match (system config didn't actually
    // change in this test, but the recreate path ran).
    const after = dns.getServers();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error("server list changed across recreate: " + JSON.stringify({ before, after }));
    }

    console.log("PASS");
  `);
});

test("config-change signal preserves setLocalAddress binding", async () => {
  // setLocalAddress writes directly onto the c-ares channel; a config-change
  // recreate must replay it. No public getter exists, so assert the recreate
  // path with a stashed local address doesn't throw.
  await run(`
    const dns = require("node:dns");
    const { dnsConfigChanged, dnsConfigGeneration } = require("bun:internal-for-testing");

    const r = new dns.Resolver();
    r.setLocalAddress("127.0.0.1");
    void r.getServers();

    const g0 = dnsConfigGeneration();
    dnsConfigChanged();
    if (dnsConfigGeneration() !== g0 + 1) throw new Error("generation did not advance");

    void r.getServers();

    console.log("PASS");
  `);
});

test("config-change signal does not override user-set servers", async () => {
  await run(`
    const dns = require("node:dns");
    const { dnsConfigChanged } = require("bun:internal-for-testing");

    dns.setServers(["9.9.9.9"]);
    if (JSON.stringify(dns.getServers()) !== JSON.stringify(["9.9.9.9"])) {
      throw new Error("setServers did not apply");
    }

    dnsConfigChanged();

    // The user explicitly pinned servers; a network change must not reset them.
    const after = dns.getServers();
    if (JSON.stringify(after) !== JSON.stringify(["9.9.9.9"])) {
      throw new Error("user-set servers were overwritten: " + JSON.stringify(after));
    }

    // And a per-instance Resolver with defaults should still pick up the
    // change (its channel is recreated on next use).
    const r = new dns.Resolver();
    void r.getServers();
    dnsConfigChanged();
    void r.getServers(); // recreate path must not throw

    console.log("PASS");
  `);
});

test.skipIf(!isLinux)("inotify watcher fires on resolv.conf change", async () => {
  using dir = tempDir("dns-config-watch", {
    "resolv.conf": "nameserver 127.0.0.1\n",
  });
  await run(
    `
    const dns = require("node:dns");
    const { dnsConfigGeneration } = require("bun:internal-for-testing");
    const { writeFileSync } = require("node:fs");
    const { join } = require("node:path");

    // Creating the channel installs the inotify watch on BUN_DNS_CONFIG_WATCH_DIR.
    void dns.getServers();
    const g0 = dnsConfigGeneration();

    // Trigger the watch.
    writeFileSync(join(process.env.WATCH_DIR, "resolv.conf"), "nameserver 127.0.0.2\\n");

    // Wait for the inotify event to be drained by the event loop.
    const deadline = Date.now() + 5000;
    while (dnsConfigGeneration() === g0) {
      if (Date.now() > deadline) {
        throw new Error("inotify watcher did not fire within 5s");
      }
      await Bun.sleep(0);
    }

    console.log("PASS");
  `,
    { BUN_DNS_CONFIG_WATCH_DIR: String(dir), WATCH_DIR: String(dir) },
  );
});
