// The function source entries are searched by the function that each one belongs to. In every build the image checks that they are in ascending order.
// Fault injection, --aot-testing=ReverseFunctionSourceEntries: the entries are written in reverse order. The build fails with a named internal error.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = `function one() { return 1; }
function two() { return 2; }
function three() { return 3; }
const all = JSON.parse("[0,1,2]").map(i => [one, two, three][i]);
console.log(all.map(each => each.toString()).join("|"));
`;

describe.skipIf(!!unsupported)("the texts of functions", () => {
  test("stop the build by name where they are listed out of order", () =>
    slot(async () => {
      using dir = tempDir("aot-texts-of-functions", { "main.js": program });
      const folder = String(dir);
      const build = (name: string, ...flags: string[]) =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation,
            ...flags,
            "./main.js",
            "--outfile",
            name,
          ],
          folder,
          env,
        );
      expect((await build("right")).exitCode).toBe(0);
      const right = await spawned([join(folder, isWindows ? "right.exe" : "right")], folder, env);
      expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({
        stdout: "function one() { return 1; }|function two() { return 2; }|function three() { return 3; }\n",
        exitCode: 0,
      });
      const lied = await build("lied", "--aot-testing=ReverseFunctionSourceEntries");
      expect(lied.exitCode).toBe(1);
      expect(lied.stderr).toContain("TableNotSorted: functionSources");
    }));
});
