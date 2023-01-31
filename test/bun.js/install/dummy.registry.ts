import { file } from "bun";
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";

let handler, server;
export let package_dir, requested, root_url;

export function dummyRegistry(urls, version = "0.0.2", props = {}) {
  return async request => {
    urls.push(request.url);
    expect(request.method).toBe("GET");
    if (request.url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, basename(request.url))));
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    const name = request.url.slice(request.url.lastIndexOf("/") + 1);
    return new Response(
      JSON.stringify({
        name,
        versions: {
          [version]: {
            name,
            version,
            dist: {
              tarball: `${request.url}.tgz`,
            },
            ...props,
          },
        },
        "dist-tags": {
          latest: version,
        },
      }),
    );
  };
}

export async function readdirSorted(path: PathLike): Promise<string[]> {
  const results = await readdir(path);
  results.sort();
  return results;
}

export function setHandler(newHandler) {
  handler = newHandler;
}

function resetHanlder() {
  setHandler(() => new Response("Tea Break~", { status: 418 }));
}

export function dummyBeforeAll() {
  server = Bun.serve({
    async fetch(request) {
      requested++;
      return await handler(request);
    },
    port: 54321,
  });
  root_url = "http://localhost:54321";
}

export function dummyAfterAll() {
  server.stop();
}

export async function dummyBeforeEach() {
  resetHanlder();
  requested = 0;
  package_dir = realpathSync(await mkdtemp(join(tmpdir(), "bun-install.test")));
}

export async function dummyAfterEach() {
  resetHanlder();
  await rm(package_dir, { force: true, recursive: true });
}
