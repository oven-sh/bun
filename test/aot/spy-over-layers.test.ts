import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { reportsToTheRunnerAlone } from "./harness/without-core-dump";
import { test } from "./supported";

// The run takes its layers by itself: the project is larger than the memory it is allowed.

const filler = Array.from({ length: 7000 }, (_, index) => `export function filler${index}(x) { return x + ${index}; }`);
const project = () =>
  tempDir("aot-spy-over-layers", {
    "package.json": `{ "name": "spies" }`,
    "filler.mjs": filler.join("\n") + "\n",
    "lib.mjs": `export const algorithmOf = h => h.algorithm;
export const lengthOf = h => h.byteLength;
export const versionNow = () => Bun.version;
export const homeNow = () => Bun.env.HOME;
export const written = s => s.write("ab");
export const connected = () => String(fetch.preconnect("http://127.0.0.1:9/"));
export const connectedByBun = () => String(Bun.fetch.preconnect("http://127.0.0.1:9/"));
`,
    "a.test.js": `import { filler1 } from "./filler.mjs";
void filler1;
import { spyOn, test } from "bun:test";
import { algorithmOf, connected, connectedByBun, homeNow, lengthOf, versionNow, written } from "./lib.mjs";
test("what a file of the product reads under a spy and behind it", () => {
  const hasher = new Bun.CryptoHasher("sha1");
  const sha1 = new Bun.SHA1();
  const sink = new Bun.ArrayBufferSink();
  sink.start();
  const seen = () =>
    [algorithmOf(hasher), lengthOf(hasher), lengthOf(sha1), versionNow() === "0.0.0", homeNow() === "/spied", written(sink), connected(), connectedByBun()].join(" ");
  console.error("SEEN", seen());
  const spies = [
    spyOn(Bun.CryptoHasher.prototype, "algorithm", "get").mockReturnValue("spied"),
    spyOn(Bun.CryptoHasher.prototype, "byteLength", "get").mockReturnValue(7),
    spyOn(Bun.SHA1.prototype, "byteLength", "get").mockReturnValue(8),
    spyOn(Bun, "version", "get").mockReturnValue("0.0.0"),
    spyOn(Bun, "env", "get").mockReturnValue({ HOME: "/spied" }),
    spyOn(Bun.ArrayBufferSink.prototype, "write").mockReturnValue(99),
    spyOn(fetch, "preconnect").mockReturnValue("spied"),
    spyOn(Bun.fetch, "preconnect").mockReturnValue("too"),
  ];
  console.error("SEEN", seen(), spies.map(spy => spy.mock.calls.length).join(" "));
  for (const spy of spies) spy.mockRestore();
  console.error("SEEN", seen());
});
`,
  });
const env = reportsToTheRunnerAlone({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" });

async function seen(cwd: string, ...flags: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--parallel=2", "."],
    cwd,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (flags.includes("--aot")) expectLayers(stderr);
  return {
    lines: stderr.split("\n").filter(line => /^SEEN|^error|^panic|TypeError/.test(line)),
    passed: stderr.match(/^ *(\d+) pass$/m)?.[1],
    failed: stderr.match(/^ *(\d+) fail$/m)?.[1],
    exitCode,
  };
}

test("members that the host fixes are spied on as in plain Bun", async () => {
  using dir = project();
  const [plain, compiled] = await Promise.all([
    seen(String(dir)),
    seen(String(dir), "--aot", "--aot-memory-limit", "1MB"),
  ]);
  expect(plain).toMatchObject({ passed: "1", failed: "0", exitCode: 0 });
  expect(plain.lines).toEqual([
    "SEEN sha1 20 20 false false 2 undefined undefined",
    "SEEN spied 7 8 true true 99 spied too 1 1 1 1 1 1 1 1",
    "SEEN sha1 20 20 false false 2 undefined undefined",
  ]);
  expect(compiled).toEqual(plain);
});
