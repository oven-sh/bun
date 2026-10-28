import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows } from "harness";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { spawned } from "../aot/run-programs";
import { builtinEntries, canTrim, isModule, isNamedFromGlobalObject, tempDirForAotBuilds as tempDir } from "./compile-trim-features";

const program = `
  const evaluate = (() => {}).constructor as (code: string) => () => Promise<unknown>;
  const snippets: string[] = JSON.parse(process.argv[2]!);
  for (let index = Number(process.argv[3]); index < snippets.length; index++) {
    try {
      console.log(index + " value " + typeof (await evaluate("return (async () => (" + snippets[index] + "))()")()));
    } catch (error) {
      console.log(index + " thrown " + (error as { code?: string } | undefined)?.code);
    }
  }
  console.log("done");
  process.exit();
`;

const startsOrEndsAProcess =
  /^(exit|reallyExit|abort|kill|_kill|execve|spawn|spawnSync|\$|openInEditor|WebView|Terminal|cron|send|disconnect|channel|dlopen|binding|_linkedBinding|FFI|unsafe|jest|build|plugin)$/;
const changesTheProcess = /^(chdir|umask|setuid|setgid|seteuid|setegid|setgroups|initgroups|on|once|addListener|prependListener|prependOnceListener|off|removeListener|removeAllListeners|emit|emitWarning)$/;
const waitsForInput = /^(alert|confirm|prompt|stdin|openStdin|sleepSync)$/;
const isSafeToCall = (name: string) => !startsOrEndsAProcess.test(name) && !changesTheProcess.test(name) && !waitsForInput.test(name);
const takesANumberForAnAddress = /^Bun\.FFI\.(CString|closeCallback|toArrayBuffer|toBuffer)$/;

const instanceOf: Record<string, string> = {
  String: `"a"`,
  Number: "(1)",
  BigInt: "1n",
  Date: "new Date(0)",
  Array: "[1, [2]]",
  "%TypedArray%": "new Uint8Array(2)",
  Uint8Array: "new Uint8Array(2)",
  Object: "({})",
  Map: "new Map()",
  WeakMap: "new WeakMap()",
  Set: "new Set()",
  RegExp: "/a/",
  Blob: `new Blob(["a"])`,
};
const isName = (part: string) => /^[A-Za-z_$][\w$]*$/.test(part);
const members = new Map<string, { holder: string; name: string }>();
for (const { path } of builtinEntries.filter(isNamedFromGlobalObject)) {
  const parts = path.split(".");
  const name = parts.pop()!;
  const instance = parts.length === 2 && parts[1] === "prototype" ? instanceOf[parts[0]!] : undefined;
  if (!isName(name) || (instance === undefined && !parts.every(isName))) continue;
  const holder = parts.length === 0 ? "globalThis" : (instance ?? parts.join("."));
  members.set(holder === "globalThis" ? name : `${holder}.${name}`, { holder, name });
}
const paths = [...members.keys()];
const callable = [...members].filter(([path, { name }]) => isSafeToCall(name) && !takesANumberForAnAddress.test(path)).map(([path]) => path);
const modules = [...new Set(builtinEntries.filter(isModule).map(({ path }) => path))];
if (paths.length < 200 || modules.filter(name => isBuiltin(name)).length < 20) throw new Error("src/trim/features declares too few built-ins for this test to mean anything");

const instances: Record<string, object> = {
  'new Blob(["a"])': Blob.prototype,
  'new File(["a"], "a")': File.prototype,
  'new Request("http://localhost/")': Request.prototype,
  'new Response("a")': Response.prototype,
  "new Headers()": Headers.prototype,
  'new URL("http://localhost/")': URL.prototype,
  "new URLSearchParams()": URLSearchParams.prototype,
  "new FormData()": FormData.prototype,
  "new TextEncoder()": TextEncoder.prototype,
  "new TextDecoder()": TextDecoder.prototype,
  "new AbortController()": AbortController.prototype,
  "AbortSignal.abort()": AbortSignal.prototype,
  "new EventTarget()": EventTarget.prototype,
  'new Event("a")': Event.prototype,
  "new ReadableStream()": ReadableStream.prototype,
  "new WritableStream()": WritableStream.prototype,
  "new TransformStream()": TransformStream.prototype,
  "Buffer.alloc(8)": Buffer.prototype,
  "new Date(0)": Date.prototype,
  "crypto.subtle": SubtleCrypto.prototype,
};
const membersOfInstances = Object.entries(instances).flatMap(([instance, prototype]) =>
  Object.getOwnPropertyNames(prototype)
    .filter(name => name !== "constructor" && isName(name))
    .map(name => `${instance}.${name}`),
);

const snippets: Record<string, string[]> = {
  "typeof": paths.map(path => `typeof ${path}`),
  "in": [...members.values()].map(({ holder, name }) => `${JSON.stringify(name)} in Object(${holder})`),
  "reading": paths.map(path => `(${path}, 1)`),
  "calling": callable.map(path => `${path}()`),
  "calling with an argument": callable.map(path => `${path}(1)`),
  "new": callable.map(path => `new ${path}()`),
  "Bun.inspect": paths.map(path => `Bun.inspect(${path})`),
  "import()": modules.map(name => `import(${JSON.stringify(name)})`),
  "process.getBuiltinModule": modules.map(name => `process.getBuiltinModule(${JSON.stringify(name)})`),
  "enumerating every property": ["Bun", "globalThis", "process", "Intl", "performance", "console", "crypto", "navigator"].flatMap(holder => [
    `Object.entries(${holder}).length`,
    `({ ...${holder} })`,
    `Object.getOwnPropertyDescriptors(${holder})`,
    `Bun.inspect(${holder})`,
    `JSON.stringify(${holder})`,
  ]),
  "reading every member of a built-in class": membersOfInstances.map(path => `(${path}, 1)`),
  "calling every method of a built-in class": membersOfInstances.map(path => `(Promise.resolve(${path}()).catch(() => {}), 1)`),
  "new ShadowRealm": ["new ShadowRealm()", `new ShadowRealm().evaluate("typeof Atomics")`],
};

// The list is one argument. A command line of Windows holds 32,767 characters, and a quote inside an argument takes two.
function piecesThatFitACommandLine(list: string[]) {
  if (!isWindows) return [list];
  const pieces: string[][] = [[]];
  let length = 0;
  for (const snippet of list) {
    const added = 2 * JSON.stringify(snippet).length + 2;
    if (length + added > 24_000 && pieces.at(-1)!.length > 0) {
      pieces.push([]);
      length = 0;
    }
    pieces.at(-1)!.push(snippet);
    length += added;
  }
  return pieces;
}

type Exit = { snippet: string; exitCode: number | null; signal: string | null; stderr: string };

async function findExits(executable: string, cwd: string, list: string[]) {
  const exits: Exit[] = [];
  for (const piece of piecesThatFitACommandLine(list)) exits.push(...(await findExitsOfPiece(executable, cwd, piece)));
  return exits;
}

async function findExitsOfPiece(executable: string, cwd: string, list: string[]) {
  const exits: Exit[] = [];
  for (let next = 0; next <= list.length; ) {
    const { stdout, stderr, exitCode, signal } = await spawned([executable, JSON.stringify(list), String(next)], cwd, bunEnv);
    const lines = stdout.trimEnd().split("\n");
    const errors = stderr.split("\n").filter(line => line.startsWith("error"));
    if (lines.at(-1) === "done") {
      if (exitCode !== 0) exits.push({ snippet: "(an uncaught error)", exitCode, signal: signal ?? null, stderr: errors[0] ?? "" });
      break;
    }
    const finished = lines.filter(line => /^\d+ (value|thrown) /.test(line)).length;
    exits.push({ snippet: list[next + finished] ?? "(after the last snippet)", exitCode, signal: signal ?? null, stderr: errors.at(-1) ?? "" });
    next += finished + 1;
  }
  return exits;
}

export function testRemovedFeaturesNeverExit(kind: "plain" | "aot") {
  describe.skipIf(!canTrim)(`code passed to the Function constructor in a trimmed executable${kind === "aot" ? " (--aot)" : ""}`, () => {
    const dir = tempDir("compile-trim-never-exits", { "program.ts": program });
    const cwd = String(dir);
    const executable = join(cwd, "program");

    beforeAll(async () => {
      await Bun.build({ entrypoints: [join(cwd, "program.ts")], compile: { outfile: executable, trim: true, aot: kind === "aot" } });
    }, 120_000);

    afterAll(() => dir[Symbol.dispose]());

    test.concurrent.each(Object.keys(snippets))("%s does not exit the process", async name => expect(await findExits(executable, cwd, snippets[name]!)).toEqual([]), 120_000);
  });
}
