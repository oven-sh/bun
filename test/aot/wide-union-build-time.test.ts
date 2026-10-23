import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const unionNames = ["a", "b", "c", "d", "e"];
const membersPerUnion = isDebug || isASAN ? 6 : 9;
const timeout = isDebug || isASAN ? 240_000 : 30_000;

function sources(propertiesPerUnion: number) {
  const properties = unionNames.flatMap(name => Array.from({ length: propertiesPerUnion }, (_, i) => `${name}${i}`));
  const unions = unionNames.map(name => {
    const shared = Array.from({ length: propertiesPerUnion }, (_, i) => `; ${name}${i}: number`).join("");
    const members = Array.from({ length: membersPerUnion }, (_, tag) => `{ ${name}: ${tag}${shared} }`);
    return `type ${name.toUpperCase()} = ${members.join(" | ")};\n`;
  });
  const sum = properties.map(property => `wide.${property}`).join(" + ");
  const literal = [...unionNames.map(name => `${name}: 0`), ...properties.map(property => `${property}: 1`)].join(", ");
  return {
    "types.ts": `${unions.join("")}export type Wide = ${unionNames.map(name => name.toUpperCase()).join(" & ")};\n`,
    "typed.ts": `import type { Wide } from "./types";\nexport function sum(wide: Wide) {\n  return ${sum};\n}\n`,
    "untyped.js": `export function sum(wide) {\n  return ${sum};\n}\n`,
    "main.ts": `import type { Wide } from "./types";\nimport { sum } from "./untyped.js";\nconst wide = { ${literal} } as unknown as Wide;\nexport const total = sum(wide);\n`,
  };
}

async function check(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "check", ...args], cwd);
  return { output: exitCode ? stdout + stderr : "", exitCode };
}

// Each property lookup on the 59,049-member union compared every member's property with all earlier ones: 1.2 s per lookup in a release build.
test(
  "property lookup on a wide union is linear in its members",
  async () => {
    using dir = tempDir("aot-wide-union", sources(8));
    expect(await check(String(dir), ["./typed.ts"])).toEqual({ output: "", exitCode: 0 });
  },
  timeout,
);

// The argument's type became the parameter's predicted type, and every read in the untyped function looked a property up on it: over 100 s in a release build.
test(
  "an untyped function called with a wide union builds quickly",
  async () => {
    using dir = tempDir("aot-wide-union", sources(2));
    expect(await check(String(dir), ["--aot", "./main.ts"])).toEqual({ output: "", exitCode: 0 });
  },
  timeout,
);
