import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Files } from "./generate-program";

export type Build = { executable: string; seconds: number; error?: string };

export async function buildProgram(bun: string, folder: string, files: Files, env: Record<string, string | undefined>, flags: string[] = []): Promise<Build> {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), source);
  }
  const executable = join(folder, "program");
  const start = performance.now();
  const build = Bun.spawn({ cmd: [bun, "build", "--compile", "--aot", ...flags, "--target=bun", "./main.ts", "./worker.ts", "--outfile", executable], cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  return { executable, seconds: (performance.now() - start) / 1000, error: exitCode ? `exit code ${exitCode}\n${stdout}${stderr}` : undefined };
}
