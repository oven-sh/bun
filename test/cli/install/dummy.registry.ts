/**
 * This file can be directly run
 *
 *  PACKAGE_DIR_TO_USE=(realpath .) bun test/cli/install/dummy.registry.ts
 */
import { file, Server, spawn } from "bun";
import { mkdtempSync, realpathSync } from "fs";

let expect: typeof import("bun:test")["expect"];

import { mkdtemp, readdir, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { bunExe, bunEnv as env } from "harness";

export function tmpdirSync(pattern: string) {
  return mkdtempSync(join(realpathSync(tmpdir()), pattern));
}

type Handler = (req: Request) => Response | Promise<Response>;
type Pkg = {
  name: string;
  version: string;
  dist: {
    tarball: string;
  };
};
let handler: Handler;
let server: Server;
let testCounter = 0;
export let package_dir: string;
export let requested: number;
export let root_url: string;

export async function external_command(...args: Array<string>) {
  const { stdout, stderr, exited } = spawn({
    cmd: [...args],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  return { err, out, exited };
}

export async function command(...args: Array<string>) {
  return external_command(bunExe(), ...args);
}

export const getPackageJSONContents = () => file(join(package_dir, "package.json")).text();
export const getYarnLockContents = () => file(join(package_dir, "yarn.lock")).text()
  // 180 is for the extended Bun header, 83 is for the typical yarn header
  .then(s => s.slice(s[84] === '#' ? 180: 83).replaceAll(root_url, "localhost"));
export const makeBasicPackageJSON = (dependencies = {}, devDependencies = {}) => writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.0", dependencies, devDependencies }));

export function dummyRegistry(urls: string[], info: any = { "0.0.2": {} }) {
  const _handler: Handler = async request => {
    urls.push(request.url);
    expect(request.method).toBe("GET");
    if (request.url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, "resources", basename(request.url).toLowerCase())));
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    const name = request.url.slice(request.url.indexOf("/", root_url.length) + 1);
    const versions: Record<string, Pkg> = {};
    let version;
    for (version in info) {
      if (!/^[0-9]/.test(version)) continue;
      versions[version] = {
        name,
        version,
        dist: {
          tarball: `${request.url}-${info[version].as ?? version}.tgz`,
        },
        ...info[version],
      };
    }
    return new Response(
      JSON.stringify({
        name,
        versions,
        "dist-tags": {
          latest: info.latest ?? version,
        },
      }),
    );
  };
  return _handler;
}

export async function readdirSorted(path: PathLike): Promise<string[]> {
  const results = await readdir(path);
  results.sort();
  return results;
}

export function setHandler(newHandler: Handler) {
  handler = newHandler;
}

function resetHandler() {
  setHandler(() => new Response("Tea Break~", { status: 418 }));
}

export function dummyBeforeAll() {
  server = Bun.serve({
    async fetch(request) {
      requested++;
      return await handler(request);
    },
    port: 0,
  });
  root_url = `http://localhost:${server.port}`;
}

export function dummyAfterAll() {
  server.stop();
}

let packageDirGetter: () => string = () => {
  return tmpdirSync("bun-install-test-" + testCounter++ + "--");
};
export async function dummyBeforeEach() {
  resetHandler();
  requested = 0;
  package_dir = packageDirGetter();
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
  );
}

export async function dummyAfterEach() {
  resetHandler();
  await rm(package_dir, { force: true, recursive: true });
}

if (Bun.main === import.meta.path) {
  // @ts-expect-error
  expect = value => {
    return {
      toBe(expected) {
        if (value !== expected) {
          throw new Error(`Expected ${value} to be ${expected}`);
        }
      },
    };
  };
  if (process.env.PACKAGE_DIR_TO_USE) {
    packageDirGetter = () => process.env.PACKAGE_DIR_TO_USE!;
  }

  await dummyBeforeAll();
  await dummyBeforeEach();
  setHandler(dummyRegistry([]));
  console.log("Running dummy registry!\n\n URL: ", root_url!, "\n", "DIR: ", package_dir!);
} else {
  // @ts-expect-error
  ({ expect } = Bun.jest(import.meta.path));
}
