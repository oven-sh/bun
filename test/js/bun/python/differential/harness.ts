// Runs the scripts of this directory and compares what they print with what CPython 3.15 printed: see README.md.
import { Glob } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { constants } from "node:os";
import { basename, dirname, join } from "node:path";
import expectedFailures from "./expected-failures.json";
import notInCI from "./not-in-ci.json";

const root = import.meta.dir;

interface Expectation {
  status: number;
  stdout: Buffer;
  stderr?: string;
  /** The first 16 digits of the SHA-256 of the file that runs, and of the file in lang/ that it was made from. */
  script?: string;
  source?: string;
  oracle?: string;
  mask?: string;
}

function readExpectation(path: string): Expectation {
  const data = readFileSync(path);
  const end = data.indexOf("\n---\n");
  const fields = Object.fromEntries(
    data
      .subarray(0, end)
      .toString()
      .split("\n")
      .map(line => line.split(/: (.*)/s, 2)),
  );
  return { ...fields, status: Number(fields.status), stdout: data.subarray(end + 5) };
}

const digest = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);

// One to one, so that equal strings mean equal bytes; and readable, if the bytes are UTF-8, when a test fails.
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("latin1");
  }
}

const lastLine = (text: string) => text.split("\n").findLast(line => line.trim() !== "") ?? "";

/** "lang/001_x": what tools/run.py calls the test whose expectation is lang/generated/001_x.expected. */
const nameOf = (expected: string) => expected.slice(0, -".expected".length).replace("/generated/", "/");

const all = [...new Glob("**/*.expected").scanSync({ cwd: root })].sort();

// CPython printed the expectations on Linux with glibc: the names of errors, what the system has and what its C library computes
// are in them. FIXME: Find out which of the scripts print the same on macOS and with musl.
const isWhereTheExpectationsAreFrom = isLinux && !isMusl;

// Seconds in a release build, and minutes in these.
const isTooSlowHere = (name: string) =>
  (name.startsWith("slow/") && (isDebug || isASAN)) || (name === "interop/015_operators_jit" && isDebug);

// The scripts of a directory that import a module of another one.
const alsoNeeds: Record<string, string[]> = { slow: ["mod_cjk", "mod_hash"] };

/** Declares a test for each script whose name (as "mod_io/io_misc") the function accepts. */
export function differential(accepts: (name: string) => boolean) {
  // Each test is a program, some of them seconds of work, and many run at a time. These builds take seconds to start Python.
  setDefaultTimeout(isDebug || isASAN ? 300_000 : 60_000);

  const chosen = all.filter(expected => accepts(nameOf(expected)) && !(nameOf(expected) in notInCI));
  const directories = [...new Set(chosen.map(expected => expected.split("/")[0]))];

  // The scripts run in a copy, where they may leave what they like. They are used to running side by side in one directory.
  let copy: ReturnType<typeof tempDir>;
  let env: Record<string, string | undefined>;
  beforeAll(() => {
    copy = tempDir("python-differential", {});
    for (const directory of new Set(directories.flatMap(directory => [directory, ...(alsoNeeds[directory] ?? [])])))
      cpSync(join(root, directory), join(String(copy), "tests", directory), {
        recursive: true,
        filter: source => !source.endsWith(".expected"),
      });
    const home = join(String(copy), "home");
    mkdirSync(join(home, "tmp"), { recursive: true });
    // As in tools/run.py, which ran CPython so.
    env = {
      ...Object.fromEntries(Object.entries(bunEnv).filter(([key]) => !key.startsWith("PYTHON"))),
      HOME: home,
      TMPDIR: join(home, "tmp"),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      // Not a name that has to be looked up: a machine may be without the files.
      TZ: "UTC0",
      // The standard library is compiled once for all of them.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(home, "cache"),
    };
  });
  afterAll(() => copy?.[Symbol.dispose]());

  for (const directory of directories) {
    describe.skipIf(!isWhereTheExpectationsAreFrom).concurrent(directory, () => {
      for (const expected of chosen.filter(expected => expected.startsWith(directory + "/"))) {
        const name = nameOf(expected);
        test.skipIf(isTooSlowHere(name))(name, async () => {
          const want = readExpectation(join(root, expected));
          const stem = expected.slice(0, -".expected".length);
          const program = existsSync(join(root, stem + ".js")) ? stem + ".js" : stem + ".py";
          if (want.oracle !== "none")
            expect({
              script: digest(join(root, program)),
              source: want.source && digest(join(root, name + ".py")),
            }).toEqual({ script: want.script!, source: want.source }); // Otherwise: tools/run.py --update

          const cwd = realpathSync(join(String(copy), "tests", dirname(program)));
          await using proc = Bun.spawn({
            cmd: [bunExe(), basename(program)],
            env,
            cwd,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);

          const clean = (text: string) => {
            text = text.replaceAll(cwd, "<dir>");
            return want.mask === "addresses" ? text.replace(/0x[0-9a-f]{6,}/g, "0xADDR") : text;
          };
          const got = {
            stdout: clean(decode(stdout)),
            // Of stderr, the last line, if CPython failed.
            stderr: want.status === 0 ? undefined : clean(lastLine(stderr)),
            status: proc.signalCode ? -constants.signals[proc.signalCode] : exitCode,
          };
          const wanted = { stdout: decode(want.stdout), stderr: want.stderr, status: want.status };

          const reason = (expectedFailures as Record<string, string>)[name];
          if (reason === undefined) {
            // What went wrong is more often said there than in what was printed.
            if (got.status !== wanted.status) expect<object>({ ...got, allOfStderr: stderr }).toEqual(wanted);
            expect(got).toEqual(wanted);
          } else {
            // It is to be taken off the list then.
            expect(got, `it passes, and expected-failures.json says: ${reason}`).not.toEqual(wanted);
          }
        });
      }
    });
  }
}
