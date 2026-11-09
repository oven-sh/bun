// --aot-check=FlowFixpoint runs every rule of Link's flow once more over the solved sets. A call that is told is only listed, and what climbs where objects meet is folded in later:
// the check resolves what it has listed and notes what the fold raises.
// THE LIE: --aot-testing=IgnoreEscapeAfterUnknownCall: a call of super() that has entered unseen code passes over the telling that its new.target has come to hold the
// unknown. Neither program has a call whose members sleep, so nothing else stirs the flow; in the second no class has a field, so nothing climbs but where objects meet.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = (fox: string, said: string) => `class Animal {}
class Ant extends Animal {}
class Bee extends Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
class Fox extends Animal {${fox}}
class Gnu extends Animal {}
const zoo = [new Ant(), new Bee(), new Cat(), new Dog(), new Fox(), new Gnu()];
function echo(n) { return n; }
zoo[8 % zoo.length]["sp" + (zoo.length > 3 ? "eak" : "xx")] = echo;
console.log(zoo.length, ${said});
`;

describe.skipIf(!!unsupported)("the check of closure", () => {
  for (const [name, text, printed] of [
    [
      "resolves the calls that it tells",
      program(" constructor() { super(); this.legs = 4; } ", "zoo[4].legs"),
      "6 4\n",
    ],
    ["notes what climbs where objects meet", program("", "zoo[2].speak(3)"), "6 3\n"],
  ])
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-check-of-closure", { "main.js": text });
        const folder = String(dir);
        const build = (outfile: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--aot-check=FlowFixpoint",
              ...withoutDebugInformation,
              ...flags,
              "./main.js",
              "--outfile",
              outfile,
            ],
            folder,
            env,
          );
        const closed = await build("right");
        expect({ stderr: closed.stderr.includes("FlowEndedTooEarly"), exitCode: closed.exitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        const right = await spawned([join(folder, isWindows ? "right.exe" : "right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
        const lied = await build("lied", "--aot-testing=IgnoreEscapeAfterUnknownCall");
        expect(lied.stderr).toContain("FlowEndedTooEarly");
        expect(lied.exitCode).toBe(1);
      }),
    );
});
