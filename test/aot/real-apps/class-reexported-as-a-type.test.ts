import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "../supported";

function files(declaration: string) {
  return {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "preserve",
        moduleResolution: "bundler",
        moduleDetection: "force",
        strict: true,
        noEmit: true,
        lib: ["esnext", "dom"],
        types: [],
      },
    }),
    "node_modules/sockets/package.json": JSON.stringify({
      name: "sockets",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      types: "index.d.ts",
    }),
    "node_modules/sockets/index.js": `export function connect() {
  return 1;
}
`,
    "node_modules/sockets/message.d.ts": declaration,
    "node_modules/sockets/index.d.ts": `import { Message } from "./message";
export declare function connect(): number;
export { type Message };
`,
    "socket.ts": `export type { Message as SocketMessage } from "sockets";
export function defineSocket(): number {
  return 1;
}
`,
    "index.ts": `export { type SocketMessage, defineSocket } from "./socket";
`,
    "everything.ts": `export * from "./index";
export function serve(): number {
  return 2;
}
`,
    "main.ts": `import * as everything from "./everything";
console.log(Object.keys(everything).sort().join(","));
`,
  };
}

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

for (const { kind, declaration, differs } of [
  { kind: "an interface", declaration: "export interface Message {\n  text: string;\n}\n", differs: false },
  { kind: "a class", declaration: "export declare class Message {\n  text: string;\n}\n", differs: false },
])
  describe(`${kind} that a package re-exports only as a type (the shape of code in h3)`, () => {
    let executable: { stdout: string; exitCode: number } | undefined;

    test("plain Bun and bun run --aot list the two functions", async () => {
      using dir = tempDir("aot-class-reexported-as-a-type", files(declaration));
      expect(await run([bunExe(), "run", "main.ts"], String(dir))).toMatchObject({
        stdout: "defineSocket,serve\n",
        exitCode: 0,
      });
      for (const flag of ["--aot", "--debug-aot"])
        expect(await run([bunExe(), "run", flag, "main.ts"], String(dir))).toMatchObject({
          stdout: "defineSocket,serve\n",
          exitCode: 0,
        });
    });

    test("the program builds", async () => {
      using dir = tempDir("aot-class-reexported-as-a-type", files(declaration));
      expect(
        await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"], String(dir)),
      ).toMatchObject({ exitCode: 0 });
      const { stdout, exitCode } = await run([join(String(dir), "program")], String(dir));
      executable = { stdout, exitCode };
    }, 120_000);

    (differs ? test.failing : test)("the executable lists the two functions", () => {
      expect(executable).toEqual({ stdout: "defineSocket,serve\n", exitCode: 0 });
    });
  });
