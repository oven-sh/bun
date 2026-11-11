// A row of the host says what the promise that it hands out settles with: `Response.prototype.text` says a string. An `await` of such a promise is typed `anything`;
// what Link makes of the row goes on to the places that it types: a variable, a field, the parameter of a callback. In front of each stands a test in every build.
// `--aot-testing=UnderstateEffects:Builtin/<row>/ContentsOfResult` lays the row false: what its result holds is taken to be null alone.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported, withoutCrashReport } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const LIE = "--aot-testing=UnderstateEffects:Builtin/Response.prototype.text/ContentsOfResult";
const ways = {
  "a variable": {
    source: `let kept: string | null = null;
async function fill(r: Response) { kept = await r.text(); }
function use(): string { return typeof kept; }
fill(new Response(JSON.parse('"abc"'))).then(() => { console.log(use()); console.log("went on"); });
`,
    stops: "found string in a local variable",
  },
  "a field": {
    source: `class Holder { text: string | null = null; }
const holder = new Holder();
async function fill(h: Holder, r: Response) { h.text = await r.text(); }
function use(h: Holder): string { return typeof h.text; }
fill(holder, new Response(JSON.parse('"abc"'))).then(() => { console.log(use(holder)); console.log("went on"); });
`,
    stops: "StoreOfOtherType on an instance of class 'Holder'",
  },
  "the parameter of a callback": {
    source: `function use(r: Response): Promise<string> { return r.text().then(text => typeof text); }
use(new Response(JSON.parse('"abc"'))).then(kind => { console.log(kind); console.log("went on"); });
`,
    stops: "found string in an argument",
  },
};

describe.skipIf(!!unsupported)("what a promise of the host settles with", () => {
  for (const [way, { source, stops }] of Object.entries(ways)) {
    test(`goes into ${way} behind a test`, () =>
      slot(async () => {
        using dir = tempDir("aot-settled-value", { "main.ts": source });
        const folder = String(dir);
        const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
        const build = (name: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation,
              ...flags,
              "./main.ts",
              "--outfile",
              name,
            ],
            folder,
            env,
          );
        expect((await build("right")).exitCode).toBe(0);
        const right = await spawned([executable("right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({
          stdout: "string\nwent on\n",
          exitCode: 0,
        });
        expect((await build("lied", LIE)).exitCode).toBe(0);
        const lied = await spawned([executable("lied")], folder, { ...env, ...withoutCrashReport });
        expect(lied.stderr).toContain(stops);
        expect(lied.stdout).not.toContain("went on");
        expect(lied.exitCode).not.toBe(0);
      }));
  }
});
