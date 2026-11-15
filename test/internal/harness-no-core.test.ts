import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, noCoreCmd } from "harness";

test.skipIf(!isLinux)("noCoreCmd executes its child with unchanged arguments even if procfs is read-only", () => {
  const args = ["two words", `quote'"`, "$HOME;$(false)", ""];
  const result = Bun.spawnSync({
    cmd: noCoreCmd([bunExe(), "-e", `console.log(JSON.stringify(process.argv.slice(-4)))`, "--", ...args]),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
    signalCode: result.signalCode,
  }).toEqual({
    stdout: JSON.stringify(args) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: undefined,
  });
});

const filterArgs = ["two words", `quote'"`, "$HOME;$(false)", ""];
// Registration needs the actual preparation result to skip only an unavailable filter.
// Seed and control prove deleting the wrapper's write cannot pass on an inherited zero.
const filterResult = isLinux
  ? Bun.spawnSync({
      cmd: [
        "/bin/sh",
        "-c",
        `if ! { printf 0x1 > "/proc/$$/coredump_filter"; } 2>/dev/null; then
  printf 'noCoreCmd:filter-unavailable\\n'
  exit 77
fi
IFS= read -r seed < "/proc/$$/coredump_filter" || exit 78
printf 'seed:%s\\n' "$seed"
"$1" -e 'console.log("control:" + require("node:fs").readFileSync("/proc/self/coredump_filter", "utf8").trim())' || exit 78
shift
exec "$@"`,
        "--",
        bunExe(),
        ...noCoreCmd([
          bunExe(),
          "-e",
          `console.log(JSON.stringify({
  args: process.argv.slice(-4),
  filter: parseInt(require("node:fs").readFileSync("/proc/self/coredump_filter", "utf8"), 16),
}))`,
          "--",
          ...filterArgs,
        ]),
      ],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  : undefined;
const filterUnavailable =
  filterResult?.exitCode === 77 &&
  filterResult.stdout.toString() === "noCoreCmd:filter-unavailable\n" &&
  filterResult.stderr.toString() === "" &&
  filterResult.signalCode === undefined;

test.skipIf(!isLinux || filterUnavailable)("noCoreCmd clears a nonzero inherited filter on writable procfs", () => {
  const result = filterResult!;
  expect({
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
    signalCode: result.signalCode,
  }).toEqual({
    stdout: "seed:00000001\ncontrol:00000001\n" + JSON.stringify({ args: filterArgs, filter: 0 }) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: undefined,
  });
});
