/**
 * scripts/agent-cleanup.sh is the nightly launchd job on the bare macOS test
 * runners (embedded in com.buildkite.cleanup.plist by `agent.mjs install`).
 * It wipes builds/, cache/ and tmp, then reboots. The version before it ran
 * `rm -rf` and `shutdown -r now` at 06:27 with no regard for the job in
 * flight, so a darwin test shard that overlapped that minute lost its
 * checkout and its bun binary mid-run and Buildkite recorded real test
 * failures (builds 73894, 103586, 104622, 104896).
 *
 * The script now asks launchd to SIGTERM the agent (buildkite-agent finishes
 * its job and exits on the first one), waits for every buildkite-agent
 * process to be gone, and wipes and reboots only then, with a two hour cap so
 * a stuck agent cannot hold the reboot forever.
 *
 * Every tool the script calls (launchctl, pgrep, rm, shutdown, ...) is a stub
 * on a PATH that holds nothing else. Each stub appends its argv to a log, so
 * the tests assert the order of the calls. Nothing here deletes or reboots
 * anything: the script only ever finds the stubs.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "agent-cleanup.sh");

/** Append "<tool> <argv>" to $LOG. Only shell builtins, since PATH holds nothing but the stubs. */
const logCall = `#!/bin/sh\necho "\${0##*/}\${*:+ $*}" >> "$LOG"\n`;

const stubs: Record<string, string> = {
  launchctl: logCall,
  sleep: logCall,
  rm: logCall,
  chown: logCall,
  chmod: logCall,
  date: logCall + `echo 06:27:00\n`,
  uname: logCall + `echo "\${UNAME_M:-x86_64}"\n`,
  // "running" for the first RUNNING_POLLS calls, then gone. The call count lives in $COUNTER.
  pgrep:
    logCall +
    `count=0\n[ -f "$COUNTER" ] && read -r count < "$COUNTER"\necho $((count + 1)) > "$COUNTER"\n[ "$count" -lt "$RUNNING_POLLS" ]\n`,
  shutdown: logCall + `exit "\${SHUTDOWN_EXIT:-0}"\n`,
  reboot: logCall + `exit "\${REBOOT_EXIT:-0}"\n`,
};

async function runCleanup(env: Record<string, string>) {
  using dir = tempDir("agent-cleanup", {
    bin: stubs,
    // The agent home as `agent.mjs install` leaves it: the service files next
    // to builds/ and cache/, with content so that the globs expand.
    "home/agent.mjs": "",
    "home/utils.mjs": "",
    "home/agent-cleanup.sh": "",
    "home/builds/job-1/README": "",
    "home/cache/git/bun.git": "",
  });
  for (const name of Object.keys(stubs)) chmodSync(join(String(dir), "bin", name), 0o755);
  const log = join(String(dir), "cleanup.log");

  await using proc = Bun.spawn({
    cmd: ["/bin/sh", SCRIPT],
    env: {
      PATH: join(String(dir), "bin"),
      LOG: log,
      COUNTER: join(String(dir), "polls"),
      RUNNING_POLLS: "0",
      AGENT_HOME: join(String(dir), "home"),
      AGENT_USER: "administrator",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n");
  } catch {}
  return {
    stdout,
    stderr,
    exitCode,
    calls,
    tools: calls.map(call => call.split(" ")[0]),
    home: join(String(dir), "home"),
  };
}

/**
 * The rm arguments under a directory outside the fixture. /bin/sh expands the
 * script's globs against the real host: an entry per file when the directory
 * has any, the glob itself when it has none. Both count as a target.
 */
function under(args: string[], dir: string): string[] {
  return args.filter(arg => arg.startsWith(dir));
}

describe.concurrent.skipIf(isWindows)("agent-cleanup.sh", () => {
  test("waits for the running job to finish before it wipes and reboots", async () => {
    const { stdout, stderr, exitCode, calls, tools, home } = await runCleanup({ RUNNING_POLLS: "3" });

    expect(stderr).toBe("");
    expect(tools).toEqual([
      "launchctl",
      "pgrep",
      "sleep",
      "pgrep",
      "sleep",
      "pgrep",
      "sleep",
      "pgrep",
      "date",
      "uname",
      "rm",
      "chown",
      "chmod",
      "shutdown",
    ]);
    expect(calls[0]).toBe("launchctl kill SIGTERM system/buildkite-agent");
    expect(calls[1]).toBe("pgrep -x buildkite-agent");
    expect(calls[2]).toBe("sleep 30");
    expect(stdout).toBe("06:27:00 agent stopped after 90s, wiping and rebooting\n");

    const rm = calls.find(call => call.startsWith("rm "))!.split(" ");
    expect(rm.slice(0, 2)).toEqual(["rm", "-rf"]);
    expect(rm).toContain(join(home, "builds", "job-1"));
    expect(rm).toContain(join(home, "cache", "git"));
    for (const dir of [
      "/usr/local/var/buildkite-agent/builds/",
      "/usr/local/var/buildkite-agent/cache/",
      "/usr/local/etc/buildkite-agent/builds/",
      "/usr/local/etc/buildkite-agent/cache/",
      "/tmp/",
      "/var/tmp/",
    ]) {
      expect(under(rm, dir)).not.toBeEmpty();
    }
    // The service files next to builds/ and cache/ stay. The agent starts from them after the reboot.
    expect(rm).not.toContain(join(home, "agent.mjs"));
    expect(rm).not.toContain(join(home, "utils.mjs"));
    expect(rm).not.toContain(join(home, "agent-cleanup.sh"));
    expect(calls).toContain(
      "chown -R administrator:admin /usr/local/var/buildkite-agent /usr/local/etc/buildkite-agent",
    );
    expect(calls).toContain("chmod -R 755 /usr/local/var/buildkite-agent /usr/local/etc/buildkite-agent");
    expect(calls.at(-1)).toBe("shutdown -r now");
    expect(exitCode).toBe(0);
  });

  test("an idle agent is stopped and the box reboots at once", async () => {
    const { stdout, exitCode, calls, tools } = await runCleanup({ RUNNING_POLLS: "0" });

    expect(tools).toEqual(["launchctl", "pgrep", "date", "uname", "rm", "chown", "chmod", "shutdown"]);
    expect(calls[0]).toBe("launchctl kill SIGTERM system/buildkite-agent");
    expect(calls.at(-1)).toBe("shutdown -r now");
    expect(stdout).toBe("06:27:00 agent stopped after 0s, wiping and rebooting\n");
    expect(exitCode).toBe(0);
  });

  test("reboots after two hours when the agent never exits", async () => {
    const { stdout, exitCode, calls, tools } = await runCleanup({ RUNNING_POLLS: "1000000" });

    expect(tools.filter(tool => tool === "sleep")).toHaveLength(240);
    expect(tools.filter(tool => tool === "pgrep")).toHaveLength(241);
    expect(tools.indexOf("rm")).toBeGreaterThan(tools.lastIndexOf("pgrep"));
    expect(calls.at(-1)).toBe("shutdown -r now");
    expect(stdout).toBe("06:27:00 agent stopped after 7200s, wiping and rebooting\n");
    expect(exitCode).toBe(0);
  });

  test("uses the Homebrew prefix of the host architecture", async () => {
    const { calls } = await runCleanup({ UNAME_M: "arm64" });

    const rm = calls.find(call => call.startsWith("rm "))!.split(" ");
    expect(under(rm, "/opt/homebrew/var/buildkite-agent/builds/")).not.toBeEmpty();
    expect(under(rm, "/usr/local/")).toBeEmpty();
    expect(calls).toContain(
      "chown -R administrator:admin /opt/homebrew/var/buildkite-agent /opt/homebrew/etc/buildkite-agent",
    );
  });

  test("starts the agent again when the reboot fails", async () => {
    const { calls } = await runCleanup({ SHUTDOWN_EXIT: "1", REBOOT_EXIT: "1" });

    expect(calls.slice(-3)).toEqual(["shutdown -r now", "reboot", "launchctl kickstart system/buildkite-agent"]);
  });

  test("does nothing when the plist did not set AGENT_HOME and AGENT_USER", async () => {
    const { exitCode, calls, stderr } = await runCleanup({ AGENT_HOME: "" });

    expect(calls).toEqual([]);
    expect(stderr).toContain("AGENT_HOME");
    expect(exitCode).not.toBe(0);
  });
});
