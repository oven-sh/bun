import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Nothing in JS reports smol mode directly. On Linux it lowers the size at
// which a Blob is backed by a memfd (LinuxMemFdAllocator::should_use: 1 MiB in
// smol mode, 8 MiB otherwise), and the memfd is visible in /proc/self/fd while
// the Blob is alive, so a 2 MiB Blob tells the two modes apart.
const probe = /* js */ `
  const { readdirSync, readlinkSync } = require("node:fs");
  const blob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
  const memfd = readdirSync("/proc/self/fd").some(fd => {
    try {
      return readlinkSync("/proc/self/fd/" + fd).startsWith("/memfd:memfd-num-");
    } catch {
      return false;
    }
  });
  console.log("mode:" + (memfd ? "smol" : "normal") + ":" + blob.size);
`;

// Stands in for the probe source in argv so test names stay readable.
const PROBE = "<probe>";

type Case = [bunfig: string, argv: string[], expected: "smol" | "normal"];

async function runCase([bunfig, argv, expected]: Case, files: Record<string, string>) {
  if (bunfig) files["bunfig.toml"] = bunfig + "\n";
  using dir = tempDir("bunfig-smol", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv.map(arg => (arg === PROBE ? probe : arg))],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.match(/^mode:(\w+):2097152$/m)?.[1], stderr).toBe(expected);
  expect(exitCode, stderr).toBe(0);
}

describe.skipIf(!isLinux).concurrent("bunfig.toml smol", () => {
  const cases: Case[] = [
    ["", ["index.js"], "normal"],
    ["smol = false", ["index.js"], "normal"],
    ["[test]\nsmol = true", ["index.js"], "normal"],
    // bunfig.toml is read while argv is being parsed for these.
    ["smol = true", ["index.js"], "smol"],
    ["smol = true", ["-e", PROBE], "smol"],
    // `bun run` reads bunfig.toml after argv has been applied.
    ["smol = true", ["run", "index.js"], "smol"],
    // The flag wins over the file in either order.
    ["smol = false", ["--smol", "index.js"], "smol"],
    ["smol = false", ["run", "--smol", "index.js"], "smol"],
    ["smol = false", ["--smol", "run", "index.js"], "smol"],
  ];

  test.each(cases)("%j + bun %j -> %s", (bunfig, argv, expected) =>
    runCase([bunfig, argv, expected], { "index.js": probe }),
  );
});

describe.skipIf(!isLinux).concurrent("bunfig.toml test.smol", () => {
  const testFile = `import { test } from "bun:test";\ntest("probe", () => {${probe}});\n`;

  const cases: Case[] = [
    ["", ["test", "probe.test.js"], "normal"],
    ["[test]\nsmol = true", ["test", "probe.test.js"], "smol"],
    ["[test]\nsmol = false", ["test", "--smol", "probe.test.js"], "smol"],
    ["[test]\nsmol = false", ["--smol", "test", "probe.test.js"], "smol"],
  ];

  test.each(cases)("%j + bun %j -> %s", (bunfig, argv, expected) =>
    runCase([bunfig, argv, expected], { "probe.test.js": testFile }),
  );
});
