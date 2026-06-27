import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import fs from "node:fs";

// On Linux the dns.lookup default backend is c-ares, whose hosts-file cache
// used to merge entries by IP before hostname. When a later line's IP was
// already associated with another hostname (for example 127.0.0.1, which is
// always present for localhost), that line's address was dropped from the
// target hostname's entry. A family-filtered lookup then found nothing in
// the hosts file and fell through to a real DNS query.
//
// The test has to append to the system hosts file so c-ares reads it. Skip
// when it isn't writable (CI containers run as root; developer hosts usually
// are not). macOS and Windows use the system resolver by default so the bug
// is not observable there via node:dns.
const hostsPath = "/" + ["etc", "hosts"].join("/");
let hostsWritable = false;
try {
  fs.accessSync(hostsPath, fs.constants.W_OK);
  hostsWritable = true;
} catch {}

describe.skipIf(!isLinux || !hostsWritable)("dns.lookup with multi-line hosts-file entries", () => {
  async function runWithHosts(lines: string[], script: string) {
    const saved = fs.readFileSync(hostsPath, "utf8");
    let stdout: string, stderr: string, exitCode: number | null;
    try {
      fs.writeFileSync(hostsPath, saved + "\n" + lines.join("\n") + "\n");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    } finally {
      fs.writeFileSync(hostsPath, saved);
    }
    return { stdout, stderr, exitCode };
  }

  function lookupScript(name: string, options: string) {
    return `
      const dns = require("node:dns");
      dns.lookup(${JSON.stringify(name)}, ${options}, (err, res) => {
        if (err) {
          console.log(JSON.stringify({ code: err.code || String(err) }));
        } else {
          console.log(JSON.stringify(res.map(r => r.address + "/" + r.family).sort()));
        }
      });
    `;
  }

  // IPv6 line first, then an IPv4 line whose address already appears in the
  // system hosts file (127.0.0.1 for localhost).
  test("returns every address family listed for the name (all: true)", async () => {
    const name = "cares-hosts-merge-a.test";
    const { stdout, stderr, exitCode } = await runWithHosts(
      [`2001:db8::a ${name}`, `127.0.0.1 ${name}`],
      lookupScript(name, `{ all: true }`),
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify(["127.0.0.1/4", "2001:db8::a/6"]));
    expect(exitCode).toBe(0);
  });

  test("family: 4 finds the IPv4 from the hosts file instead of falling through to DNS", async () => {
    const name = "cares-hosts-merge-b.test";
    const { stdout, stderr, exitCode } = await runWithHosts(
      [`2001:db8::b ${name}`, `127.0.0.1 ${name}`],
      lookupScript(name, `{ all: true, family: 4 }`),
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify(["127.0.0.1/4"]));
    expect(exitCode).toBe(0);
  });

  test("family: 6 finds the IPv6 when the colliding-IP line comes second", async () => {
    const name = "cares-hosts-merge-c.test";
    const { stdout, stderr, exitCode } = await runWithHosts(
      [`10.217.217.1 ${name}`, `::1 ${name}`],
      lookupScript(name, `{ all: true, family: 6 }`),
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify(["::1/6"]));
    expect(exitCode).toBe(0);
  });

  test("order: ipv4first surfaces both families", async () => {
    const name = "cares-hosts-merge-d.test";
    const { stdout, stderr, exitCode } = await runWithHosts(
      [`2001:db8::d ${name}`, `127.0.0.1 ${name}`],
      `
        const dns = require("node:dns");
        dns.lookup(${JSON.stringify(name)}, { all: true, order: "ipv4first" }, (err, res) => {
          if (err) return console.log(JSON.stringify({ code: err.code || String(err) }));
          console.log(JSON.stringify(res.map(r => r.address + "/" + r.family)));
        });
      `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify(["127.0.0.1/4", "2001:db8::d/6"]));
    expect(exitCode).toBe(0);
  });
});
