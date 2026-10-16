// What ./servers.test.ts and ./features.test.ts share.
import { expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { spawned } from "../run-programs";

export const wanted = process.env.AOT_SERVERS;

/** The names that AOT_SERVERS asks for. Without it all of them, so that each is listed as skipped. */
export function selected(names: string[]) {
  return names.filter(name => !wanted || wanted === "1" || wanted.split(",").includes(name.split(".")[0]));
}

/** Installs the packages that the package.json in the folder names. */
export async function installed(folder: string) {
  if (process.env.AOT_SERVERS_MODULES) return symlinkSync(process.env.AOT_SERVERS_MODULES, join(folder, "node_modules"));
  const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, bunEnv);
  expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
}

/** Starts a server on a free port and waits until it prints `listening <port>`. */
export async function started(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  // Express prints every error that it answers with 400.
  const proc = Bun.spawn({ cmd, cwd, env: { ...env, PORT: "0", NODE_ENV: "production" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const errors = proc.stderr.text();
  let printed = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    printed += chunk;
    const port = /^listening (\d+)$/m.exec(printed)?.[1];
    if (port) return { origin: `http://127.0.0.1:${port}`, [Symbol.dispose]: () => proc.kill("SIGKILL") };
  }
  throw new Error(`${cmd.join(" ")} ended with exit code ${await proc.exited} before it listened:\n${await errors}`);
}
