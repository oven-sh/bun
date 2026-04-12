import { test, expect } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { bunEnv, bunExe, isLinux } from "harness";

// https://github.com/oven-sh/bun/issues/29227
//
// On Linux, `dns.lookup()` for a name that only has an IPv4 entry in
// /etc/hosts must return only IPv4, matching Node. Previously Bun's
// default backend returned an extra `::1` entry (and, because the
// default result order is `verbatim`, that `::1` became the single
// result returned by the callback form).
//
// This test requires Linux because it mutates /etc/hosts. The bug is
// Linux-specific — macOS uses LibInfo and Windows uses libuv, both
// already matching Node.
test.skipIf(!isLinux)("dns.lookup respects /etc/hosts and matches Node", async () => {
  // Use a random tag so re-runs don't conflict. The tag is long enough
  // that it's extremely unlikely to collide with anything on the host.
  const tag = "bun-issue-29227-" + Math.random().toString(36).slice(2, 10);
  const hostsEntry = `\n127.0.0.1 ${tag}\n`;

  // /etc/hosts is a system file; snapshot-then-restore so a crashed
  // test can't leave the system in a bad state.
  let original: string;
  try {
    original = readFileSync("/etc/hosts", "utf8");
  } catch {
    // Not writable / not root — skip. CI Linux is root in the container.
    return;
  }

  try {
    appendFileSync("/etc/hosts", hostsEntry);
  } catch {
    return;
  }

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const dns = require("node:dns");
const name = ${JSON.stringify(tag)};
dns.lookup(name, { all: true }, (err, results) => {
  if (err) { console.error("ERR:" + err.code); process.exit(1); }
  console.log(JSON.stringify(results));
});
dns.lookup(name, (err, address, family) => {
  if (err) { console.error("ERR:" + err.code); process.exit(1); }
  console.log("single:" + address + ":" + family);
});
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Filter out the ASAN warning that debug builds print to stderr.
    const realStderr = stderr
      .split("\n")
      .filter(l => l && !l.includes("ASAN"))
      .join("\n");
    expect(realStderr).toBe("");

    // Stdout assertions come before exitCode so a failure surfaces the
    // actual output rather than an opaque exit-code mismatch.
    const lines = stdout.trim().split("\n");
    const allLine = lines.find(l => l.startsWith("["))!;
    const singleLine = lines.find(l => l.startsWith("single:"))!;

    expect(JSON.parse(allLine)).toEqual([{ address: "127.0.0.1", family: 4 }]);
    expect(singleLine).toBe("single:127.0.0.1:4");
    expect(exitCode).toBe(0);
  } finally {
    // Always restore /etc/hosts, even if assertions fail.
    writeFileSync("/etc/hosts", original);
  }
});
