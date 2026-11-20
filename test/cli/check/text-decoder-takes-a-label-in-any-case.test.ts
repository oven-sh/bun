// `bun compile` type checks what it builds, so a label that runs on Bun and that the declarations of Bun refuse stops the build.
// The project is the one that `bun init` writes: no library for browsers, and the types of Bun.
import { expect, test } from "bun:test";
import { bunExe, tempDirWithBunTypes } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    types: ["bun"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
});

const program = `console.log(new TextDecoder("UTF-8").encoding, new TextDecoder(" Shift_JIS ", { fatal: true }).encoding);
console.log(new TextDecoderStream("LATIN1").encoding);
`;

const printed = `utf-8 shift_jis
windows-1252
`;

// The first two labels throw on Bun, and so does the label in the tuple and in the class. The third is known only at run time,
// and a constructor type whose label is a string could be given any of them.
const refused = `declare const charset: string;
// @ts-expect-error
new TextDecoder("utf-99");
// @ts-expect-error
new TextDecoder("\\u212Aoi8-r");
// @ts-expect-error
new TextDecoder(charset);
// @ts-expect-error
export const args: ConstructorParameters<typeof TextDecoder> = ["utf-99"];
class Sub extends TextDecoder {}
// @ts-expect-error
new Sub("utf-99");
// @ts-expect-error
export const Alias: new (label: string) => TextDecoder = TextDecoder;
`;

// One check reads every declaration of Bun and of Node.js, which takes a debug build several seconds.
test("TextDecoder takes a label in any ASCII case", async () => {
  using dir = tempDirWithBunTypes("check-text-decoder-labels", {
    "tsconfig.json": tsconfig,
    "index.ts": program,
    "refused.ts": refused,
  });
  expect(await run([bunExe(), "index.ts"], String(dir))).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  const checked = await run([bunExe(), "check", "--no-pretty"], String(dir));
  // The summary on stderr has a time in it. Where the check fails, the message shows all three.
  expect(checked.exitCode === 0 ? { stdout: checked.stdout, exitCode: 0 } : checked).toEqual({
    stdout: "",
    exitCode: 0,
  });
}, 60_000);
