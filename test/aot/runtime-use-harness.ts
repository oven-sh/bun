import { bunEnv, bunExe, tempDir } from "harness";

export const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowJs: true, types: [] },
});

export async function runtimeUse(files: Record<string, string>, command = ["check", "--aot", "--no-pretty"], entryPoint = "main.ts", env: Record<string, string> = {}) {
  using dir = tempDir("aot-runtime-use", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command, "--aot-explain=runtime-use", entryPoint],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  const opened = lines.filter(line => line.startsWith("open "));
  const byTheProgram = opened.filter(line => !/ in \/\$bun\/js\/\S+$/.test(line));
  const whyOpen = byTheProgram.map(line => line.slice("open ".length).replace(/ in \S+$/, ""));
  const world = lines[0] === "closed" || (opened.length > 0 && byTheProgram.length === 0) ? "closed" : "open";
  return { lines, facts: new Set(lines), world, whyOpen, isOpenedByTheRuntime: opened.length > byTheProgram.length, stdout, stderr, exitCode };
}

export const declared = `declare const HTMLRewriter: any, Bun: any, process: any, console: any, require: any, module: any, Worker: any, addEventListener: any;\n`;
export const of = (text: string) => runtimeUse({ "main.ts": declared + text });
const declaredForServers = `declare const Response: any, Bun: any, process: any, console: any, setTimeout: any, reportError: any;\n`;
export const withDeclarations = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, path.endsWith(".ts") ? declaredForServers + text : text]));
