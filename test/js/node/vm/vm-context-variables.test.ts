import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A `var` or a function that a script declares at its top is a variable of the context's global object, and the object that was made the context shows it: after the declaration's own store and
// after every later one. The engine stored straight into the variable's slot once the variable's watchpoint set was gone, which is at the second store, so the third never reached the object;
// without the JIT a variable has no such set, and no store did. The answers are Node's.
const program = String.raw`const vm = require("node:vm");
const texts = [
  "var made = 42",
  "var made = seed * 21",
  "var made; made = 42",
  "function made() {}",
  "var made",
  "var made = seed; made = 2",
  "var made = seed; made = 2; made = 3",
  "var made = seed; made = 2; made = 3; made = 4",
  "var made = seed; for (var i = 0; i < 5; i++) made = i",
  "var made = 0 * seed; function bump() { made++ } bump(); bump(); bump()",
  "made = 42",
  "this.made = 42",
  "let made = seed",
  "var made = seed; delete this.made",
];
for (const text of texts) {
  const sandbox = { seed: 2 };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox);
  console.log(text + ": " + (typeof sandbox.made === "function" ? "function" : String(sandbox.made)) + " | " + Object.keys(sandbox).join() + " | " + Object.getOwnPropertyNames(sandbox).join());
}
`;
const answers = `var made = 42: 42 | seed,made | seed,made
var made = seed * 21: 42 | seed,made | seed,made
var made; made = 42: 42 | seed,made | seed,made
function made() {}: function | seed,made | seed,made
var made: undefined | seed | seed
var made = seed; made = 2: 2 | seed,made | seed,made
var made = seed; made = 2; made = 3: 3 | seed,made | seed,made
var made = seed; made = 2; made = 3; made = 4: 4 | seed,made | seed,made
var made = seed; for (var i = 0; i < 5; i++) made = i: 4 | seed,made,i | seed,made,i
var made = 0 * seed; function bump() { made++ } bump(); bump(); bump(): 3 | seed,bump,made | seed,bump,made
made = 42: 42 | seed,made | seed,made
this.made = 42: 42 | seed,made | seed,made
let made = seed: undefined | seed | seed
var made = seed; delete this.made: undefined | seed | seed
`;

async function run(text: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", text],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test("every store to a variable of a context shows on the sandbox object, without the JIT", async () => {
  expect(await run(program, { BUN_JSC_useJIT: "0" })).toEqual({
    stdout: answers,
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// The decoded code was handed to the baseline JIT whatever the options said.
test("a script made from cached data runs without the JIT", async () => {
  const text = String.raw`
    const vm = require("node:vm");
    const source = "function add(a, b) { return a + b } add(1, 2)";
    const cachedData = new vm.Script(source).createCachedData();
    const script = new vm.Script(source, { cachedData });
    console.log(script.cachedDataRejected, script.runInThisContext());
  `;
  expect(await run(text, { BUN_JSC_useJIT: "0" })).toEqual({
    stdout: "false 3\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
