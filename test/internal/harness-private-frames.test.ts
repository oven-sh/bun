import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";
import { locksEnvironment } from "../aot/hardened";

const name = "BUN_JSC_showPrivateScriptsInStackTraces";
const isOption = (key: string) => key.toLowerCase() === name.toLowerCase();
const withoutOption = Object.fromEntries(Object.entries(bunEnv).filter(([key]) => !isOption(key)));
const printEntries = `
  import { bunEnv } from "harness";
  console.log(JSON.stringify(Object.entries(bunEnv).filter(([key]) => key.toLowerCase() === "${name.toLowerCase()}")));
`;

/** What the `bunEnv` of a process that starts with `set` in its environment holds for the option. */
async function entriesOfBunEnv(set: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", printEntries],
    cwd: join(import.meta.dir, ".."),
    env: { ...withoutOption, ...set },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { entries: stdout && JSON.parse(stdout), stderr, exitCode };
}

// Only a debug build turns the option on.
test.skipIf(!isDebug || locksEnvironment)(
  "bunEnv turns showPrivateScriptsInStackTraces off unless the environment sets it",
  async () => {
    // JSC reads the name of an option in any case.
    const otherSpelling = name.toUpperCase();
    expect(
      await Promise.all([
        entriesOfBunEnv({}),
        entriesOfBunEnv({ [name]: "1" }),
        entriesOfBunEnv({ [otherSpelling]: "1" }),
      ]),
    ).toEqual([
      { entries: [[name, "0"]], stderr: "", exitCode: 0 },
      { entries: [[name, "1"]], stderr: "", exitCode: 0 },
      { entries: [[otherSpelling, "1"]], stderr: "", exitCode: 0 },
    ]);
  },
);
