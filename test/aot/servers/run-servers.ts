// Helpers shared by ./servers.test.ts and ./features.test.ts.
import { expect } from "bun:test";
import { rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";
import { spawned } from "../run-programs";

export const requestedServers = process.env.AOT_SERVERS;

/** Filters names by AOT_SERVERS. Returns all of them when it is unset, so that each shows up as skipped. */
export function filterRequested(names: string[]) {
  return names.filter(name => !requestedServers || requestedServers === "1" || requestedServers.split(",").includes(name.split(".")[0]));
}

/** AOT_SERVERS_FLAGS="--aot-heat=everything-is-hot": more flags for every build with --aot. What a server answers does not depend on them. */
export const moreFlags = (process.env.AOT_SERVERS_FLAGS ?? "").split(" ").filter(Boolean);
/** AOT_SERVERS_ENVIRONMENT="A=1 B=2": more variables for every run of an executable that was built with --aot. */
export const moreEnvironment = Object.fromEntries((process.env.AOT_SERVERS_ENVIRONMENT ?? "").split(" ").filter(Boolean).map(pair => pair.split("="))); // prettier-ignore

/** Runs `bun install` in the folder, or links AOT_SERVERS_MODULES as its node_modules. */
export async function installPackages(folder: string) {
  if (process.env.AOT_SERVERS_MODULES) return symlinkSync(process.env.AOT_SERVERS_MODULES, join(folder, "node_modules"));
  const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, bunEnv);
  expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
}

const exits: Promise<number>[] = [];

/** Removes the folders once every server has exited: Windows removes neither the file of an executable that runs nor the folder it runs in. */
export async function removeFolders(...folders: string[]) {
  await Promise.all(exits);
  const deadline = Date.now() + 10_000;
  for (const folder of folders) {
    while (true) {
      try {
        rmSync(folder, { recursive: true, force: true });
        break;
      } catch (error) {
        if (!isWindows || Date.now() > deadline) throw error;
        await Bun.sleep(100);
      }
    }
  }
}

/** Starts a server on a free port and waits for it to print `listening <port>`. */
export async function startServer(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  // stderr is piped because Express logs every error it responds to with 400.
  const proc = Bun.spawn({ cmd, cwd, env: { ...env, PORT: "0", NODE_ENV: "production" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  exits.push(proc.exited);
  const errors = proc.stderr.text();
  let output = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    output += chunk;
    const port = /^listening (\d+)$/m.exec(output)?.[1];
    if (port) return { origin: `http://127.0.0.1:${port}`, [Symbol.dispose]: () => proc.kill("SIGKILL") };
  }
  throw new Error(`${cmd.join(" ")} exited with code ${await proc.exited} before listening:\n${await errors}`);
}
