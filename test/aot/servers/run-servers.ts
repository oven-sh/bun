// Helpers shared by ./servers.test.ts and ./features.test.ts.
import { expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { spawned } from "../run-programs";

export const requestedServers = process.env.AOT_SERVERS;

/** Filters names by AOT_SERVERS. Returns all of them when it is unset, so that each shows up as skipped. */
export function filterRequested(names: string[]) {
  return names.filter(name => !requestedServers || requestedServers === "1" || requestedServers.split(",").includes(name.split(".")[0]));
}

/** Runs `bun install` in the folder, or links AOT_SERVERS_MODULES as its node_modules. */
export async function installPackages(folder: string) {
  if (process.env.AOT_SERVERS_MODULES) return symlinkSync(process.env.AOT_SERVERS_MODULES, join(folder, "node_modules"));
  const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, bunEnv);
  expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
}

/** Starts a server on a free port and waits for it to print `listening <port>`. */
export async function startServer(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  // stderr is piped because Express logs every error it responds to with 400.
  const proc = Bun.spawn({ cmd, cwd, env: { ...env, PORT: "0", NODE_ENV: "production" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const errors = proc.stderr.text();
  let output = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    output += chunk;
    const port = /^listening (\d+)$/m.exec(output)?.[1];
    if (port) return { origin: `http://127.0.0.1:${port}`, [Symbol.dispose]: () => proc.kill("SIGKILL") };
  }
  throw new Error(`${cmd.join(" ")} exited with code ${await proc.exited} before listening:\n${await errors}`);
}
