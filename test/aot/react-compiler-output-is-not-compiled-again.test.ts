// A component file that imports `c` from the compiler runtime is the React Compiler's output already. With the compiler on, an executable runs such a file as it is
// written: each call of `c` that the file has asks for one cache. A file that the compiler took once more would ask for a second one.
// ./react-compiler/react-stand-in has the modules that the files import, under the name of the runtime for React 19 and under the one for React 17 and 18.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "./harness/commands";
import { eachRow, gap } from "./supported";

const standIn = join(import.meta.dir, "react-compiler", "react-stand-in");

const files = {
  ...Object.fromEntries(
    ["compiler-runtime.js", "jsx-runtime.d.ts", "jsx-runtime.js"].map(name => [
      "react-stand-in/" + name,
      readFileSync(join(standIn, name), "utf8"),
    ]),
  ),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
      lib: ["ESNext", "DOM"],
      jsx: "react-jsx",
      allowJs: true,
      paths: {
        "react/jsx-runtime": ["./react-stand-in/jsx-runtime"],
        "react/jsx-dev-runtime": ["./react-stand-in/jsx-runtime"],
        "react/compiler-runtime": ["./react-stand-in/compiler-runtime.js"],
        "react-compiler-runtime": ["./react-stand-in/compiler-runtime.js"],
      },
    },
  }),
  "build.ts": `const [outfile, mode] = process.argv.slice(2);
const result = await Bun.build({
  entrypoints: ["./main.ts"],
  target: "bun",
  reactCompiler: true,
  reactCompilerOutputMode: "client",
  compile: { outfile, aot: mode === "aot" },
  throw: false,
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
  "Remembered.tsx": `import { c as _c } from "react/compiler-runtime";

export function Remembered(props: { title: string }) {
  const $ = _c(2);
  let t0;
  if ($[0] !== props.title) {
    const lines = [props.title, "remembered"];
    t0 = <p>{lines.join(" ")}</p>;
    $[0] = props.title;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
`,
  "Titled.tsx": `import { c as _c } from "react-compiler-runtime";

export function Titled(props: { title: string }) {
  const $ = _c(3);
  let t0;
  if ($[0] !== props.title) {
    const words = [props.title, "titled"];
    t0 = <b>{words.join(" ")}</b>;
    $[0] = props.title;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
`,
  "main.ts": `import { Remembered } from "./Remembered";
import { Titled } from "./Titled";

console.log(Remembered({ title: "kept" }), Titled({ title: "kept too" }));
`,
};

// The parser leaves such a file alone. The loader of --aot has its own way to the compiler, which does not ask the parser.
eachRow([
  ["is bundled", "bundled"],
  gap("the loader of --aot takes the file once more: caches of 4, 2, 4 and 3", ["is compiled with --aot", "aot"]),
] as const)(
  "an executable that %s runs a component file that is compiled already as it is written",
  (_how, mode) =>
    slot(async () => {
      using dir = tempDir("aot-react-compiler-output", files);
      const folder = String(dir);
      const program = join(folder, "program" + (isWindows ? ".exe" : ""));
      const built = await spawned([bunExe(), "build.ts", program, mode], folder, bunEnv);
      expect({ stderr: built.stderr, exitCode: built.exitCode, signal: built.signal }).toEqual({
        stderr: expect.any(String),
        exitCode: 0,
        signal: null,
      });
      const { stdout, stderr, exitCode, signal } = await spawned([program], folder, bunEnv);
      expect({ stdout, stderr, exitCode, signal }).toEqual({
        stdout: "<p>kept remembered</p> <b>kept too titled</b>\n",
        stderr: "[react-compiler] a cache of 2\n[react-compiler] a cache of 3\n",
        exitCode: 0,
        signal: null,
      });
    }),
  600_000,
);
