import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

// When the entry point has run, the host looks at its default export for a server to start. A compiled entry point has no `bun:main`
// above it, and the executable asks the host for the same look.

const env = { ...bunEnv, NO_COLOR: "1" };

async function build(cwd: string, entry: string, flags: string[]) {
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", "compiled"],
    cwd,
    env,
    stdout: "ignore",
    stderr: "inherit",
  });
  expect(await build.exited).toBe(0);
}

test.each([
  [
    "the host's call of Bun.serve()",
    `export default { port: 99999999, fetch() { return new Response("first"); } };`,
    'RangeError: The value of "options.port" is out of range. It must be >= 0 and <= 65535. Received 99999999',
    'note: Bun called Bun.serve() with the default export of "main.ts"',
  ],
  [
    "a read that the host makes",
    `export default { get fetch(): never { throw new Error("read of fetch"); } };`,
    "error: read of fetch",
    'note: Bun looked for a server in the default export of "main.ts"',
  ],
])("an error of %s says what the host did", async (_, source, error, note) => {
  using dir = tempDir("aot-the-host-looks-for-a-server", { "main.ts": source + `\nconsole.log("ran");` });
  const cwd = String(dir);
  await build(cwd, "./main.ts", []);
  const failed = async (cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stderr.split(/\r?\n/);
    const at = lines.indexOf(error);
    // The executable names the file by where it holds it.
    return {
      stdout,
      error: lines.slice(at, at + 2).map(line => line.replace(/"[^"]*main\.ts"$/, '"main.ts"')),
      exitCode,
    };
  };
  const plain = await failed([bunExe(), "main.ts"]);
  expect(plain).toEqual({ stdout: "ran\n", error: [error, note], exitCode: 1 });
  expect(await failed(["./compiled"])).toEqual(plain);
});

// A Worker of an executable has a `bun:main`, and the loader hands a data file of the executable to it as a compiled module. The
// host reads the namespace of that module as the `import * as start` of `bun:main` does. Where Bun has assertions, the compiler
// aborts in about half of its runs of --compile-inspector (SEGV in WTF::removeIterator, with and without this look), so this case
// runs where Bun has none.
test.skipIf(isDebug || isASAN)("a Worker whose entry point is a data file of the executable ends", async () => {
  using dir = tempDir("aot-the-host-looks-for-a-server-data", {
    "main.mjs": `
      import data from "./data.json" with { type: "json" };
      const worker = new Worker(new URL("./data.json", import.meta.url).href);
      worker.addEventListener("error", event => console.log("error:", event.message));
      worker.addEventListener("close", event => console.log("closed:", event.code, data.name));
    `,
    "data.json": `{ "name": "data" }`,
  });
  const cwd = String(dir);
  await build(cwd, "./main.mjs", ["--compile-inspector", "--loader=.json:text"]);
  await using proc = Bun.spawn({ cmd: ["./compiled"], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "closed: 0 data\n", exitCode: 0 });
});
