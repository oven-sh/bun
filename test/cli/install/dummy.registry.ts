/**
 * This file can be directly run
 *
 *  PACKAGE_DIR_TO_USE=(realpath .) bun test/cli/install/dummy.registry.ts
 */
import { file, Server } from "bun";
import { tmpdirSync } from "harness";

let expect: (typeof import("bun:test"))["expect"];

import { readdir, writeFile } from "fs/promises";
import { basename, join } from "path";

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
export let package_dir: string;
export let requested: number;
export let root_url: string;
export function dummyRegistry(urls: string[], info: any = { "0.0.2": {} }, numberOfTimesTo500PerURL = 0) {
  let retryCountsByURL = new Map<string, number>();
  const _handler: Handler = async request => {
    urls.push(request.url);
    const url = request.url.replaceAll("%2f", "/");

    let status = 200;

    if (numberOfTimesTo500PerURL > 0) {
      let currentCount = retryCountsByURL.get(request.url);
      if (currentCount === undefined) {
        retryCountsByURL.set(request.url, numberOfTimesTo500PerURL);
        status = 500;
      } else {
        retryCountsByURL.set(request.url, currentCount - 1);
        status = currentCount > 0 ? 500 : 200;
      }
    }

    expect(request.method).toBe("GET");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, basename(url).toLowerCase())), { status });
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");

    const name = url.slice(url.indexOf("/", root_url.length) + 1);
    const versions: Record<string, Pkg> = {};
    let version;
    for (version in info) {
      if (!/^[0-9]/.test(version)) continue;
      versions[version] = {
        name,
        version,
        dist: {
          tarball: `${url}-${info[version].as ?? version}.tgz`,
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
      {
        status: status,
      },
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
  return tmpdirSync();
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
