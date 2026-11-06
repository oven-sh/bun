// Programs in Python that use what Bun, Node and packages of JavaScript offer.
//
// The checks of a group are lines of Python, each with what it is to print: `repr()` of the value of the
// expression, or `!Type: message` of the exception. What is expected was written by hand, from what somebody who knows both
// languages would expect. A check with a third item does not hold today, and the item says why: it is a `test.failing`, which
// fails once the check holds, and is then to be made an ordinary one.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// These builds take seconds to start Python, and a program waits for its turn (see run()).
if (isDebug || isASAN) setDefaultTimeout(180_000);

/** Statements, the last line of which is an expression (`await` is fine); what it prints; why it does not, if it does not. */
export type Check = [code: string, expected: string, notYet?: string];

export interface Program {
  /** Runs before the checks. */
  setup?: string;
  /** Runs after them. */
  teardown?: string;
  /** Files beside the program. */
  files?: Record<string, string>;
}

const prelude = `
def _show(index, text):
    print(f"{index}\\t" + text.replace("\\\\", "\\\\\\\\").replace("\\n", "\\\\n"), flush=True)
`;

// A file starts all its programs when it is loaded, up to nineteen of them. Side by side they take each other's time, and on the slow
// builds, where one takes up to 40 s by itself, the limit below is for a program that has a processor more or less to itself.
let turnsLeft = isDebug || isASAN ? 4 : Infinity;
const waitingForTurn: (() => void)[] = [];
async function takeTurn() {
  if (turnsLeft) --turnsLeft;
  else await new Promise<void>(resolve => waitingForTurn.push(resolve));
  return {
    [Symbol.dispose]() {
      const next = waitingForTurn.shift();
      if (next) next();
      else ++turnsLeft;
    },
  };
}

export async function run(files: Record<string, string>, args: string[] = ["main.py"]) {
  using turn = await takeTurn();
  using dir = tempDir("python-host", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // A program that hangs fails the checks it did not get to, and no more time is lost.
    timeout: isDebug || isASAN ? 75_000 : 15_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, dir: String(dir) };
}

/** A program with a test of its own. It starts when the file is loaded, so that all the programs of a file run side by side. */
export function script(
  title: string,
  files: Record<string, string>,
  verify: (result: Awaited<ReturnType<typeof run>>) => void,
  failing?: "failing",
  args?: string[],
) {
  const running = run(files, args);
  running.catch(() => {});
  (failing ? test.failing : test.concurrent)(title, async () => verify(await running));
}

export const lines = (...all: string[]) => all.map(line => line + "\n").join("");

/**
 * `const group = program()`, once in a file. All the groups of a file are one program, one after the other: to start Python,
 * and asyncio, takes a debug build seconds.
 */
export function program() {
  const groups: { program: Program; checks: Check[]; first: number }[] = [];
  let count = 0;
  let running: ReturnType<typeof run> | undefined;

  function source(): string {
    const parts = [prelude];
    for (const { program, checks, first } of groups) {
      parts.push(program.setup ?? "");
      checks.forEach(([code], index) => {
        const lines = code.trim().split("\n");
        const last = lines.pop()!;
        parts.push(
          "try:",
          ...lines.map(line => "    " + line),
          `    _show(${first + index}, repr((${last})))`,
          "except BaseException as _e:",
          `    _show(${first + index}, "!" + type(_e).__name__ + ": " + str(_e))`,
        );
      });
      parts.push(program.teardown ?? "");
    }
    return parts.join("\n") + "\n";
  }

  // Not before the file has been read to its end.
  const result = () =>
    (running ??= run({ ...Object.assign({}, ...groups.map(({ program }) => program.files)), "main.py": source() }));
  queueMicrotask(() => result().catch(() => {}));

  async function printed() {
    const byIndex = new Map<number, string>();
    for (const line of (await result()).stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab > 0 && /^\d+$/.test(line.slice(0, tab)))
        byIndex.set(
          Number(line.slice(0, tab)),
          line.slice(tab + 1).replace(/\\(\\|n)/g, (_, c) => (c === "n" ? "\n" : "\\")),
        );
    }
    return byIndex;
  }

  return function group(name: string, program: Program, checks: Check[]) {
    const first = count;
    count += checks.length;
    if (groups.push({ program, checks, first }) === 1) {
      test.concurrent("the program ends as it should", async () => {
        const { stderr, exitCode } = await result();
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });
    }

    describe(name, () => {
      checks.forEach(([code, expected, notYet], index) => {
        const title = code.trim().split("\n").join("; ") + (notYet ? ` (${notYet})` : "");
        (notYet ? test.failing : test.concurrent)(title, async () => {
          expect((await printed()).get(first + index)).toBe(expected);
        });
      });
    });
  };
}
