import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.serve sourcemap generation", () => {
  test("development: false should not include sourcemap comments in JS", async () => {
    const dir = tempDirWithFiles("html-no-sourcemaps", {
      "index.html": /*html*/ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Production Build</title>
            <script type="module" src="script.js"></script>
          </head>
          <body>
            <h1>Production</h1>
          </body>
        </html>
      `,
      "script.js": /*js*/ `
        console.log("Hello from production");
        const foo = () => {
          return "bar";
        };
        foo();
      `,
    });

    const { subprocess, port, hostname } = await waitForProductionServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using server = subprocess;

    const html = await (await fetch(`http://${hostname}:${port}/`)).text();
    const jsSrc = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];

    if (!jsSrc) {
      throw new Error("No script src found in HTML");
    }

    const response = await fetch(new URL(jsSrc, `http://${hostname}:${port}`));
    const js = await response.text();
    const headers = response.headers;

    // Should NOT contain sourceMappingURL comment
    expect(js).not.toContain("sourceMappingURL");

    // Should NOT have SourceMap header
    expect(headers.get("SourceMap")).toBeNull();
  });

  test("development: true should include sourcemap comments in JS", async () => {
    const dir = tempDirWithFiles("html-with-sourcemaps", {
      "index.html": /*html*/ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Development Build</title>
            <script type="module" src="script.js"></script>
          </head>
          <body>
            <h1>Development</h1>
          </body>
        </html>
      `,
      "script.js": /*js*/ `
        console.log("Hello from development");
        const foo = () => {
          return "bar";
        };
        foo();
      `,
    });

    const { subprocess, port, hostname } = await waitForDevelopmentServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using server = subprocess;

    const html = await (await fetch(`http://${hostname}:${port}/`)).text();
    const jsSrc = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];

    if (!jsSrc) {
      throw new Error("No script src found in HTML");
    }

    const response = await fetch(new URL(jsSrc, `http://${hostname}:${port}`));
    const js = await response.text();
    const headers = response.headers;

    // SHOULD contain sourceMappingURL comment
    expect(js).toContain("sourceMappingURL");

    // SHOULD have SourceMap header
    expect(headers.get("SourceMap")).toBeTruthy();
  });

  test("development: { hmr: false } should not include sourcemap comments", async () => {
    const dir = tempDirWithFiles("html-dev-no-hmr", {
      "index.html": /*html*/ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Development without HMR</title>
            <script type="module" src="script.js"></script>
          </head>
          <body>
            <h1>Development without HMR</h1>
          </body>
        </html>
      `,
      "script.js": /*js*/ `
        console.log("Hello from dev no hmr");
      `,
    });

    const { subprocess, port, hostname } = await waitForDevNoHMRServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using server = subprocess;

    const html = await (await fetch(`http://${hostname}:${port}/`)).text();
    const jsSrc = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];

    if (!jsSrc) {
      throw new Error("No script src found in HTML");
    }

    const response = await fetch(new URL(jsSrc, `http://${hostname}:${port}`));
    const js = await response.text();
    const headers = response.headers;

    // In development mode (even without HMR), sourcemaps SHOULD be included
    expect(js).toContain("sourceMappingURL");
    expect(headers.get("SourceMap")).toBeTruthy();
  });
});

async function waitForProductionServer(
  dir: string,
  entryPoints: Record<string, string>,
): Promise<{
  subprocess: Subprocess;
  port: number;
  hostname: string;
}> {
  let defer = Promise.withResolvers<{
    subprocess: Subprocess;
    port: number;
    hostname: string;
  }>();

  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "serve-production.js")],
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
    },
    cwd: dir,
    stdio: ["inherit", "inherit", "inherit"],
    ipc(message, subprocess) {
      subprocess.send({
        files: entryPoints,
      });
      defer.resolve({
        subprocess,
        port: message.port,
        hostname: message.hostname,
      });
    },
  });

  return defer.promise;
}

async function waitForDevelopmentServer(
  dir: string,
  entryPoints: Record<string, string>,
): Promise<{
  subprocess: Subprocess;
  port: number;
  hostname: string;
}> {
  let defer = Promise.withResolvers<{
    subprocess: Subprocess;
    port: number;
    hostname: string;
  }>();

  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "serve-development.js")],
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
    },
    cwd: dir,
    stdio: ["inherit", "inherit", "inherit"],
    ipc(message, subprocess) {
      subprocess.send({
        files: entryPoints,
      });
      defer.resolve({
        subprocess,
        port: message.port,
        hostname: message.hostname,
      });
    },
  });

  return defer.promise;
}

async function waitForDevNoHMRServer(
  dir: string,
  entryPoints: Record<string, string>,
): Promise<{
  subprocess: Subprocess;
  port: number;
  hostname: string;
}> {
  let defer = Promise.withResolvers<{
    subprocess: Subprocess;
    port: number;
    hostname: string;
  }>();

  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "serve-dev-no-hmr.js")],
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
    },
    cwd: dir,
    stdio: ["inherit", "inherit", "inherit"],
    ipc(message, subprocess) {
      subprocess.send({
        files: entryPoints,
      });
      defer.resolve({
        subprocess,
        port: message.port,
        hostname: message.hostname,
      });
    },
  });

  return defer.promise;
}
