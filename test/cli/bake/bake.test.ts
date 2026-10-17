import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const env = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1", NO_COLOR: "1" };

const page = `<!doctype html><html><body></body></html>`;

async function getServerUrl(proc: Subprocess<"ignore", "pipe", "pipe">) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk, { stream: true });
    const url = text.match(/url: (http:\/\/\S+)/)?.[1];
    if (url) return url;
  }
  throw new Error("No server URL in stdout:\n" + text + "\nstderr:\n" + (await proc.stderr.text()));
}

async function get(url: string, path: string) {
  const res = await fetch(new URL(path, url));
  return `${res.status} ${await res.text()}`;
}

function spawnBake(dir: string, args: string[]) {
  return Bun.spawn({
    cmd: [bunExe(), ...args],
    env,
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

test.concurrent("bun bake serves app/pages, then app/server.ts routes, then its fetch", async () => {
  using dir = tempDir("bake-command", {
    "app/pages/index.html": `<!doctype html><html><body><h1>Home</h1></body></html>`,
    "app/pages/docs/index.html": `<!doctype html><html><body><h1>Docs</h1></body></html>`,
    "app/pages/docs/install.html": `<!doctype html><html><body><h1>Install</h1></body></html>`,
    "app/server.ts": `
      export default {
        routes: { "/api/hello": () => Response.json({ hi: 1 }) },
        fetch: req => new Response("fallback " + new URL(req.url).pathname, { status: 404 }),
      };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const pages = await Promise.all(["/", "/docs", "/docs/install"].map(path => fetch(new URL(path, url))));
  expect(pages.map(res => res.status)).toEqual([200, 200, 200]);
  const html = await Promise.all(pages.map(res => res.text()));
  expect(html[0]).toContain("<h1>Home</h1>");
  expect(html[1]).toContain("<h1>Docs</h1>");
  expect(html[2]).toContain("<h1>Install</h1>");

  expect(await get(url, "/api/hello")).toBe(`200 {"hi":1}`);
  expect(await get(url, "/missing")).toBe("404 fallback /missing");
});

test.concurrent("bun bake takes a flag's value as the next argument", async () => {
  using dir = tempDir("bake-command-flags", { "app/pages/index.html": page });

  await using proc = spawnBake(String(dir), ["bake", "--port", "0", "--host", "localhost"]);
  const url = await getServerUrl(proc);

  expect(new URL(url).hostname).toBe("localhost");
  expect(await get(url, "/")).toStartWith("200 ");
});

test.concurrent.each([
  { name: "bun --check bake", args: ["--check", "bake"] },
  { name: "bun bake --check", args: ["bake", "--check"] },
])("$name does not serve a project with type errors", async ({ args }) => {
  using dir = tempDir("bake-command-check", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { lib: ["ESNext", "DOM"], strict: true } }),
    "app/pages/index.html": page,
    "app/server.ts": `
      const count: number = "not a number";
      export default { fetch: () => new Response(String(count)) };
    `,
  });

  await using proc = spawnBake(String(dir), [...args, "--port=0"]);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("TS2322");
  expect(stdout).not.toContain("url: ");
  expect(exitCode).toBe(1);
});

test.concurrent("bun bake --check serves a project with no type errors", async () => {
  using dir = tempDir("bake-command-check-ok", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { lib: ["ESNext", "DOM"], strict: true } }),
    "app/pages/index.html": page,
    "app/server.ts": `
      const count: number = 1;
      export default { fetch: () => new Response(String(count)) };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--check", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await get(url, "/missing")).toBe("200 1");
});

test.concurrent("bun bake runs the project's own bake script instead", async () => {
  using dir = tempDir("bake-command-script", {
    "package.json": JSON.stringify({ scripts: { bake: "echo from the bake script" } }),
    "app/pages/index.html": page,
  });

  await using proc = spawnBake(String(dir), ["bake"]);
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("from the bake script\n");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  {
    name: "a route that is also a page",
    files: {
      "app/pages/about.html": page,
      "app/server.ts": `export default { routes: { "/about": new Response("x") } };`,
    },
    error: `The route "/about" in "app/server.ts" is also the page "app/pages/about.html".`,
  },
  {
    name: "two pages with the same URL",
    files: { "app/pages/docs.html": page, "app/pages/docs/index.html": page },
    error: `"app/pages/docs.html" and "app/pages/docs/index.html" are both the page "/docs".`,
  },
  {
    name: "an option bun bake does not use",
    files: { "app/server.ts": `export default { fetch: () => new Response("x"), port: 1234 };` },
    error: `"app/server.ts": the default export has "port", but "bun bake" only uses "routes", "fetch", "websocket".`,
  },
  {
    name: "a default export that is not an object",
    files: { "app/server.ts": `export default 42;` },
    error: `"app/server.ts" must have a default export with "routes", "fetch" or "websocket".`,
  },
  {
    name: "a page with a [param]",
    files: { "app/pages/blog/[slug].html": page },
    error: `"app/pages/blog/[slug].html": a page cannot have "[", ":" or "*" in its path. Its URL must be fixed.`,
  },
  // `:` is not allowed in a file name on Windows.
  ...(isWindows
    ? []
    : [
        {
          name: "a page with a :param",
          files: { "app/pages/users/:id.html": page },
          error: `"app/pages/users/:id.html": a page cannot have "[", ":" or "*" in its path. Its URL must be fixed.`,
        },
      ]),
  {
    name: "nothing to serve",
    files: { "README.md": "" },
    error: `there are no pages in app/pages/ and no app/server.ts.`,
  },
  {
    name: "an unknown argument",
    files: { "app/pages/index.html": page },
    args: ["--nope"],
    error: `Unknown argument "--nope". Run "bun bake --help" for the usage.`,
  },
  {
    name: "a flag with no value",
    files: { "app/pages/index.html": page },
    args: ["--port"],
    error: `"--port" needs a value.`,
  },
])("bun bake rejects $name", async ({ files, args, error }) => {
  using dir = tempDir("bake-command-error", files);

  await using proc = spawnBake(String(dir), ["bake", ...(args ?? ["--port=0"])]);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(error);
  expect(stdout).not.toContain("url: ");
  expect(exitCode).toBe(1);
});

test.concurrent("bun bake --help", async () => {
  using dir = tempDir("bake-command-help", { "README.md": "" });

  await using proc = spawnBake(String(dir), ["bake", "--help"]);
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("bun bake [options]");
  expect(stdout).toContain("app/pages/**/*.html");
  expect(stdout).toContain("--check");
  expect(exitCode).toBe(0);
});

test.concurrent("bun bake serves a page with a non-ASCII name at its encoded URL", async () => {
  using dir = tempDir("bake-command-unicode", {
    "app/pages/über.html": `<!doctype html><html><body><h1>Über</h1></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  // `fetch` sends the path percent-encoded, as browsers do.
  const res = await fetch(new URL("/über", url));
  expect(new URL(res.url).pathname).toBe("/%C3%BCber");
  expect(await res.text()).toContain("<h1>Über</h1>");
  expect(res.status).toBe(200);
});
