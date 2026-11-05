import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// hash() of a str or of bytes depends on a key that the process draws when Python starts in it, or makes from PYTHONHASHSEED as
// CPython does. (differential/mod_hash has the command line of python3; here Bun runs under its own name.)

const { PYTHONHASHSEED, ...env } = bunEnv;

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const files = {
  "show.py": `print(hash("abc"), hash(b"abc"), hash("\\u20ac"), hash("\\U0001f600"), list({"a", "b", "c", "d"}))\n`,
  "main.js": `import "./show.py";\n`,
  "hashes.py": `def of(text): return hash(text)\n`,
  "worker.js": `import hashes from "./hashes.py";\npostMessage(String(hashes.of("abc")));\n`,
  "with-worker.js": `
import hashes from "./hashes.py";
const worker = new Worker(new URL("./worker.js", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data === String(hashes.of("abc")));
  worker.terminate();
};
`,
};

async function run(file: string, seed?: string) {
  using dir = tempDir("python-hash-seed", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: seed === undefined ? env : { ...env, PYTHONHASHSEED: seed },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What CPython 3.15 prints.
const expected = {
  "0": "-4594863902769663758 -4594863902769663758 -5529981157763016009 -3536540696076613844 ['d', 'c', 'a', 'b']\n",
  "42": "3869580338025362921 3869580338025362921 -9193319877017669544 6601963133753205906 ['c', 'd', 'a', 'b']\n",
};

describe.concurrent("PYTHONHASHSEED", () => {
  for (const file of ["show.py", "main.js"]) {
    for (const [seed, stdout] of Object.entries(expected)) {
      test(`${seed}: bun ${file}`, async () => {
        expect(await run(file, seed)).toEqual({ stdout, stderr: "", exitCode: 0 });
      });
    }
  }

  test("without it, or with 'random', each process has a key of its own", async () => {
    const outputs = await Promise.all([run("show.py"), run("show.py"), run("show.py", "random"), run("main.js")]);
    expect(new Set(outputs.map(output => output.stdout)).size).toBe(4);
    expect(outputs.map(output => output.exitCode)).toEqual([0, 0, 0, 0]);
  });

  test("a worker has the key of the process", async () => {
    expect(await run("with-worker.js")).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
  });

  test("what is no seed", async () => {
    const { stdout, stderr, exitCode } = await run("show.py", "4294967296");
    expect(stdout).toBe("");
    expect(stderr).toContain('PYTHONHASHSEED must be "random" or an integer in range [0; 4294967295]');
    expect(exitCode).toBe(1);
  });
});
