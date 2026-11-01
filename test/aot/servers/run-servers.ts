// Helpers of the tests of this folder that build a server in a copy of ./app.
import { expect } from "bun:test";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows } from "harness";
import { basename, delimiter, join } from "path";
import { spawned } from "../harness/commands";

export const requestedServers = process.env.AOT_SERVERS;

/** Filters names by AOT_SERVERS. Returns all of them when it is unset, so that each shows up as skipped. */
export function filterRequested(names: string[]) {
  return names.filter(
    name => !requestedServers || requestedServers === "1" || requestedServers.split(",").includes(name.split(".")[0]),
  );
}

/** AOT_SERVERS_FLAGS="--aot-heat=everything-is-hot": more flags for every build with --aot. What a server answers does not depend on them. */
export const moreFlags = (process.env.AOT_SERVERS_FLAGS ?? "").split(" ").filter(Boolean);
/** AOT_SERVERS_ENVIRONMENT="A=1 B=2": more variables for every run of an executable that was built with --aot. */
export const moreEnvironment = Object.fromEntries((process.env.AOT_SERVERS_ENVIRONMENT ?? "").split(" ").filter(Boolean).map(pair => pair.split("="))); // prettier-ignore

/** Returns a line for each package of the lockfile that the node_modules folder holds in another version or not at all. */
export function packagesUnlikeLockfile(lockfile: string, modules: string) {
  const { packages } = Bun.JSONC.parse(readFileSync(lockfile, "utf8")) as { packages: Record<string, [string]> };
  return Object.entries(packages).flatMap(([key, [resolved]]) => {
    const expected = resolved.slice(resolved.lastIndexOf("@") + 1);
    const manifest = join(modules, key.match(/(@[^/]+\/)?[^/]+/g)!.join("/node_modules/"), "package.json");
    const found = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : "nothing";
    return found === expected ? [] : [`${key}: the lockfile has ${expected}, the folder has ${found}`];
  });
}

/** Runs `bun install` in the folder, by its bun.lock if it has one, or links AOT_SERVERS_MODULES, which must hold the same packages, as its node_modules. */
/** Returns a line for each direct dependency of the manifest that the node_modules folder holds in another version or not at all. */
export function packagesUnlikeManifest(manifest: string, modules: string) {
  const { dependencies, devDependencies } = JSON.parse(readFileSync(manifest, "utf8"));
  return Object.entries<string>({ ...dependencies, ...devDependencies }).flatMap(([name, expected]) => {
    const found = join(modules, name, "package.json");
    const version = existsSync(found) ? JSON.parse(readFileSync(found, "utf8")).version : "nothing";
    return version === expected ? [] : [`${name}: the manifest has ${expected}, ${modules} has ${version}`];
  });
}

/**
 * Installs the packages of the folder's manifest. Where AOT_SERVERS_MODULES names a node_modules folder, nothing is
 * installed: the folder is handed that one, or the first of AOT_SERVERS_MORE_MODULES, that holds what its manifest names.
 */
export async function installPackages(folder: string) {
  const given = [process.env.AOT_SERVERS_MODULES, ...(process.env.AOT_SERVERS_MORE_MODULES?.split(delimiter) ?? [])];
  if (given[0]) {
    const unlikeManifest = given.map(modules => packagesUnlikeManifest(join(folder, "package.json"), modules!));
    const modules = given[unlikeManifest.findIndex(lines => !lines.length)];
    if (!modules)
      throw new Error(
        `neither AOT_SERVERS_MODULES nor AOT_SERVERS_MORE_MODULES names a folder that holds what ${basename(folder)}/package.json names:\n${unlikeManifest.flat().join("\n")}`,
      );
    const lockfile = join(folder, "bun.lock");
    const unlike = existsSync(lockfile) ? packagesUnlikeLockfile(lockfile, modules) : [];
    if (unlike.length)
      throw new Error(
        `AOT_SERVERS_MODULES=${modules} does not hold the packages of bun.lock, so nothing counted here would be what CI counts:\n${unlike.join("\n")}`,
      );
    return symlinkSync(modules, join(folder, "node_modules"), "junction");
  }
  const byLockfile = existsSync(join(folder, "bun.lock")) ? ["--frozen-lockfile"] : [];
  const install = await spawned(
    [bunExe(), "install", ...byLockfile, "--ignore-scripts", "--linker", "hoisted"],
    folder,
    bunEnv,
  );
  expect({ stderr: install.exitCode ? install.stderr : "", exitCode: install.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
}

/** Copies ./app to the folder and installs its packages there. */
export async function copyApp(folder: string) {
  cpSync(join(import.meta.dir, "app"), folder, {
    recursive: true,
    filter: source => basename(source) !== "node_modules",
  });
  await installPackages(folder);
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
  const proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...env, PORT: "0", NODE_ENV: "production" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
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
