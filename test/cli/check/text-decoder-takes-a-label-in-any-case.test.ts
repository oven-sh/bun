// `bun compile` type checks what it builds, so a label that runs on Bun and that the declarations of Bun refuse stops the build.
// The project is the one that `bun init` writes: no library for browsers, and the types of Bun.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";

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

// The first two labels throw on Bun, and so does the label in the tuple and in the class. The third is known only at run time.
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
`;

async function run(dir: string, ...command: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...command], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

// One check reads every declaration of Bun and of Node.js, which takes a debug build several seconds.
test("TextDecoder takes a label in any ASCII case", async () => {
  using dir = tempDirWithBunTypes("check-text-decoder-labels", {
    "tsconfig.json": tsconfig,
    "index.ts": program,
    "refused.ts": refused,
  });
  expect(await run(String(dir), "index.ts")).toEqual({ stdout: printed, exitCode: 0 });
  const checked = await run(String(dir), "check", "--no-pretty");
  expect({
    errors: checked.stdout.split("\n").filter(line => line.includes("error TS")),
    exitCode: checked.exitCode,
  }).toEqual({
    errors: [],
    exitCode: 0,
  });
}, 60_000);
