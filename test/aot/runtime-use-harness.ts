import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";

export const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowJs: true, types: [] },
});

const importsUndeclaredModule = /\bfrom "(?:bun|(?:bun|node):[^"]*)"|\b(?:import|require)\("(?:bun|(?:bun|node|http):[^"]*)"\)/;

export async function runtimeUse(files: Record<string, string>, command = ["check", "--aot", "--no-pretty"], entryPoint = "main.ts", env: Record<string, string> = {}) {
  const hasUndeclaredModule = Object.values(files).some(text => importsUndeclaredModule.test(text));
  using dir = tempDir("aot-runtime-use", { "tsconfig.json": tsconfig, ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path, hasUndeclaredModule && path.endsWith(".ts") ? "// @ts-nocheck\n" + text : text])) });
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command, "--explain=trim", entryPoint], String(dir), { ...bunEnv, NO_COLOR: "1", ...env });
  const prefix = "aot: trim: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length).replace(/^uses /, ""));
  const whyOpen = lines.filter(line => line.startsWith("blocked by ")).map(line => line.slice("blocked by ".length));
  return { lines, whyOpen, stdout, stderr, exitCode };
}

export const declared = `declare const HTMLRewriter: any, Bun: any, process: any, console: any, require: any, module: any, Worker: any, addEventListener: any;\n`;
export const of = (text: string) => runtimeUse({ "main.ts": declared + text });
const declaredForServers = `declare const Response: any, Bun: any, process: any, console: any, setTimeout: any, reportError: any;\n`;
export const withDeclarations = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, path.endsWith(".ts") ? declaredForServers + text : text]));
