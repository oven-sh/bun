import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1", NO_COLOR: "1" };

const page = `<!doctype html><html><body></body></html>`;

// The type checker reads only the ES library, which keeps `--check` fast in a debug build.
// `app/server.ts` declares what it uses of the web APIs instead (`declare const Response: any;`).
const checkedTsconfig = JSON.stringify({ compilerOptions: { lib: ["ES2022"], types: [], strict: true } });

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

function spawnBake(dir: string, args: string[], extraEnv: Record<string, string> = {}) {
  return Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...env, ...extraEnv },
    cwd: dir,
    // Some fixtures catch SIGTERM, so the cleanup of `await using` would wait for an exit that never comes.
    killSignal: "SIGKILL",
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

test.concurrent("bun bake --check serves a project with no type errors", async () => {
  using dir = tempDir("bake-command-check-ok", {
    "tsconfig.json": checkedTsconfig,
    "app/pages/index.html": page,
    "app/server.ts": `
      declare const Response: any;
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
    waits: true,
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
    name: "routes that are not an object",
    waits: true,
    files: { "app/server.ts": `export default { routes: null };` },
    error: `"app/server.ts": "routes" must be an object.`,
  },
  {
    name: "a default export that is not an object",
    waits: true,
    files: { "app/server.ts": `export default 42;` },
    error: `"app/server.ts" must have a default export with "routes", "fetch" or "websocket".`,
  },
  {
    name: "a page with a [param]",
    files: { "app/pages/blog/[slug].html": page },
    error: `"app/pages/blog/[slug].html": a page cannot have "[", "]", ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
  },
  {
    name: "a page with a ] in its name",
    files: { "app/pages/a]b.html": page },
    error: `"app/pages/a]b.html": a page cannot have "[", "]", ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
  },
  // `:` is not allowed in a file name on Windows.
  ...(isWindows
    ? []
    : [
        {
          name: "a page with a :param",
          files: { "app/pages/users/:id.html": page },
          error: `"app/pages/users/:id.html": a page cannot have "[", "]", ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
        },
      ]),
  {
    name: "nothing to serve",
    files: { "README.md": "" },
    error: `Add a page, such as app/pages/index.html, or an app/server.ts.`,
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
  {
    name: "a port that is not a number",
    files: { "app/pages/index.html": page },
    args: ["--port=abc"],
    error: `"--port" needs a port from 0 to 65535, not "abc".`,
  },
  {
    name: "a port that is too large",
    files: { "app/pages/index.html": page },
    args: ["--port", "70000"],
    error: `"--port" needs a port from 0 to 65535, not "70000".`,
  },
  {
    name: "a port in hexadecimal",
    files: { "app/pages/index.html": page },
    args: ["--port=0x1F90"],
    error: `"--port" needs a port from 0 to 65535, not "0x1F90".`,
  },
  {
    name: "a port of spaces",
    files: { "app/pages/index.html": page },
    args: ["--port", "  "],
    error: `"--port" needs a port from 0 to 65535, not "  ".`,
  },
  {
    name: "a host with a port that is not a number",
    files: { "app/pages/index.html": page },
    args: ["--host=localhost:abc"],
    error: `"--host" needs a port from 0 to 65535, not "abc".`,
  },
  {
    name: "--watch, as it reloads on its own",
    files: { "app/pages/index.html": page },
    args: ["--watch"],
    error: `Unknown argument "--watch".`,
  },
  {
    // An empty hostname would make the dev server listen on every interface, not on localhost.
    name: "an empty host",
    files: { "app/pages/index.html": page },
    args: ["--host="],
    error: `"--host" needs a hostname.`,
  },
  {
    name: "a bake.config.ts option it does not use",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default { plugin: [] };` },
    error: `"bake.config.ts": the config has "plugin", but "bun bake" only uses "plugins".`,
  },
  {
    name: "a plugin in bake.config.ts with no setup()",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default { plugins: [{ name: "half" }] };` },
    error: `"bake.config.ts": the plugin "half" has no setup() function. "bun bake" takes Bun plugins.`,
  },
  {
    name: "plugins in bake.config.ts that are not an array",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default { plugins: {} };` },
    error: `"bake.config.ts": "plugins" must be an array.`,
  },
  {
    name: "a plugin in bake.config.ts that is not an object",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default { plugins: ["bun-plugin-tailwind"] };` },
    error: `"bake.config.ts": plugins[0] is not a plugin object.`,
  },
  {
    name: "a plugin in bake.config.ts with no name",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default { plugins: [{ setup() {} }] };` },
    error: `"bake.config.ts": plugins[0] has no "name".`,
  },
  {
    name: "two plugins in bake.config.ts with a framework",
    files: {
      "app/pages/.keep": "",
      "r.ts": `export function render() { return new Response("x"); }`,
      "bake.config.ts": `
        const framework = { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./r.ts" }] };
        export default { plugins: [{ name: "a", framework }, { name: "b", framework }] };
      `,
    },
    waits: true,
    error: `"bake.config.ts": the plugins "a" and "b" both have a framework.`,
  },
  {
    name: "a framework that Bun.serve() rejects",
    files: {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: { fileSystemRouterTypes: [{ root: "app/pages", serverEntryPoint: "./r.ts" }] } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": 'fileSystemRouterTypes[0]' is missing 'style'`,
  },
  {
    name: "a framework with clientPages and serverComponents",
    files: {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
        fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./r.ts", clientEntryPoint: "./r.ts", clientPages: true }],
        serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: "./rt.ts" },
      } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": 'fileSystemRouterTypes[n].clientPages' cannot be used with 'serverComponents'`,
  },
  {
    name: "a framework with plugins",
    files: {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: { plugins: [], fileSystemRouterTypes: [] } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": "plugins" is not supported in "bun bake". Add build plugins to "plugins" of bake.config.ts.`,
  },
  {
    name: "a framework with clientPages and no clientEntryPoint",
    files: {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
        fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./r.ts", clientPages: true }],
      } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": 'fileSystemRouterTypes[0].clientPages' needs a 'clientEntryPoint'`,
  },
  {
    name: "a framework whose clientPages has no serverExports list",
    files: {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
        fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./r.ts", clientEntryPoint: "./c.ts", clientPages: {} }],
      } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": 'fileSystemRouterTypes[0].clientPages.serverExports' must be an array of export names`,
  },
  {
    name: "a .tsx page and an .html page at the same URL",
    files: {
      "app/pages/index.html": page,
      "app/pages/index.tsx": `document.title = "a script of the .html page";`,
    },
    error: `"app/pages/index.tsx" and "app/pages/index.html" are both the page "/". Move the script of the .html page out of app/pages/.`,
  },
  {
    name: "a framework router whose root folder does not exist",
    files: {
      "r.ts": `export function render() { return new Response("x"); }`,
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: { fileSystemRouterTypes: [{ root: "src/route", style: "nextjs-pages", serverEntryPoint: "./r.ts" }] } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": its router's root folder "src/route" does not exist.`,
  },
  {
    name: "a framework entry point that cannot be found",
    files: {
      "app/pages/.keep": "",
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./nope.ts" }] } }] };`,
    },
    waits: true,
    error: `"bake.config.ts": the framework of "a": cannot find "./nope.ts", its serverEntryPoint.`,
  },
  {
    name: "a bake.config.ts default export that is not an object",
    waits: true,
    files: { "app/pages/index.html": page, "bake.config.ts": `export default 1;` },
    error: `"bake.config.ts" must have a default export: a config object, or a function that returns one.`,
  },
])("bun bake rejects $name", async ({ files, args, error, waits }) => {
  using dir = tempDir("bake-command-error", files);

  await using proc = spawnBake(String(dir), ["bake", ...(args ?? ["--port=0"])]);
  const output = collectOutput(proc);
  await output.waitFor(new RegExp(error.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  expect(output.text).not.toContain("url: ");
  if (waits) {
    // A change to a file that it loaded can fix this, so it waits for one, as `bun --hot` does. The
    // file that is not loaded is written first: it does not start a reload.
    const fixes = [
      ["bake.config.ts", `export default {};`],
      ["app/server.ts", `export default { fetch: () => new Response("fixed") };`],
    ];
    if ("bake.config.ts" in files) fixes.reverse();
    for (const [file, contents] of fixes) await Bun.write(join(String(dir), file), contents);
    await output.waitFor(/url: /);
  } else {
    expect(await proc.exited).toBe(1);
    // One line, once: not a stack trace into Bun's own code, and not again as an unhandled rejection.
    expect(output.text.trim()).toBe(`error: ${output.text.trim().slice("error: ".length)}`);
    expect(output.text.split(error).length).toBe(2);
  }
  expect(output.text).not.toContain("internal:bake");
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
    "app/pages/q&a.html": `<!doctype html><html><body><h1>Q&amp;A</h1></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  // `fetch` sends the path percent-encoded, as browsers do.
  const res = await fetch(new URL("/über", url));
  expect(new URL(res.url).pathname).toBe("/%C3%BCber");
  expect(await res.text()).toContain("<h1>Über</h1>");
  expect(res.status).toBe(200);

  // Browsers do not encode `&` in a path.
  expect(await get(url, "/q&a")).toContain("<h1>Q&amp;A</h1>");
});

/** Reads stdout and stderr of `proc` as they arrive, so a test can wait for either. */
function collectOutput(proc: Subprocess<"ignore", "pipe", "pipe">) {
  let text = "";
  let changed = Promise.withResolvers<void>();
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
      changed.resolve();
      changed = Promise.withResolvers<void>();
    }
  };
  const done = Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return {
    get text() {
      return text;
    },
    async waitFor(pattern: RegExp) {
      while (!pattern.test(text)) {
        const closed = await Promise.race([changed.promise.then(() => false), done.then(() => true)]);
        if (closed && !pattern.test(text)) {
          await proc.exited;
          throw new Error(`Exited with code ${proc.exitCode} before ${pattern}:\n${text}`);
        }
      }
      return text.match(pattern)!;
    },
  };
}

test.concurrent.each([
  { name: "bun bake --check", args: ["bake", "--check"] },
  { name: "bun --check bake", args: ["--check", "bake"] },
])("$name starts the server once the type errors are fixed", async ({ args }) => {
  using dir = tempDir("bake-command-check-watch", {
    "tsconfig.json": checkedTsconfig,
    "app/pages/index.html": page,
    "app/server.ts": `
      declare const Response: any;
      const count: number = "not a number";
      export default { fetch: () => new Response(String(count)) };
    `,
  });

  await using proc = spawnBake(String(dir), [...args, "--port=0"]);
  const output = collectOutput(proc);
  await output.waitFor(/TS2322/);
  expect(output.text).not.toContain("url: ");

  await Bun.write(
    join(String(dir), "app/server.ts"),
    `declare const Response: any;\nconst count: number = 1;\nexport default { fetch: () => new Response(String(count)) };\n`,
  );
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);

  // One save can start the process twice on Windows, and each start prints its own port.
  if (!isWindows) {
    expect(await get(url, "/missing")).toBe("200 1");
    return;
  }
  const deadline = Date.now() + 10_000;
  let response = "";
  while (response !== "200 1" && Date.now() < deadline) {
    const latest = [...output.text.matchAll(/url: (http:\/\/\S+)/g)].at(-1)![1];
    response = await get(latest, "/missing").catch(String);
  }
  expect(response).toBe("200 1");
});

// Creating a symlink on Windows needs a privilege that CI does not have.
test.concurrent.skipIf(isWindows)("bun bake serves pages that are symlinks or in a symlinked folder", async () => {
  using dir = tempDir("bake-command-symlink", {
    "shared/page.html": `<!doctype html><html><body><h1>Shared</h1></body></html>`,
    "shared/docs/intro.html": `<!doctype html><html><body><h1>Intro</h1></body></html>`,
    "app/pages/index.html": page,
  });
  symlinkSync(join(String(dir), "shared/page.html"), join(String(dir), "app/pages/linked.html"));
  symlinkSync(join(String(dir), "shared/docs"), join(String(dir), "app/pages/docs"));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await get(url, "/linked")).toContain("<h1>Shared</h1>");
  expect(await get(url, "/docs/intro")).toContain("<h1>Intro</h1>");
});

test.concurrent("bun bake loads a file of an unknown type that app/server.ts imports as a file", async () => {
  using dir = tempDir("bake-command-asset", {
    "app/icon.png": "not really a png",
    "app/server.ts": `
      import icon from "./icon.png";
      export default { fetch: () => new Response(require("node:path").basename(icon)) };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await get(url, "/missing")).toBe("200 icon.png");
});

test.concurrent("app/server.ts is not the entry module under bun bake", async () => {
  using dir = tempDir("bake-command-main", {
    "app/server.ts": `
      export default {
        fetch: () => Response.json({ argv: process.argv.slice(1), main: Bun.main, metaMain: import.meta.main }),
      };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const res = await fetch(new URL("/missing", url));
  expect(await res.json()).toEqual({ argv: ["--port=0"], main: "", metaMain: false });
});

test.concurrent("bun bake serves the new app/server.ts after a change, on the same server", async () => {
  using dir = tempDir("bake-command-reload", {
    "app/server.ts": `export default { fetch: () => new Response("v1") };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  expect(await get(url, "/")).toBe("200 v1");

  await Bun.write(join(String(dir), "app/server.ts"), `export default { fetch: () => new Response("v2") };`);
  // The reload prints the URL again.
  const [, next] = await output.waitFor(/url: http:\/\/\S+[\s\S]*url: (http:\/\/\S+)/);

  expect(next).toBe(url);
  expect(await get(url, "/")).toBe("200 v2");
});

test.concurrent("bun bake keeps one server across reloads when it started on a later port", async () => {
  // Take the port that `bun bake` tries first, so it starts on the next one.
  await using blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("blocker") });
  using dir = tempDir("bake-command-hot-port", {
    "app/server.ts": `export default { fetch: () => new Response("v1") };`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "bake", "--host=127.0.0.1"],
    env: { ...env, PORT: String(blocker.port) },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  expect(new URL(url).port).not.toBe(String(blocker.port));

  await Bun.write(join(String(dir), "app/server.ts"), `export default { fetch: () => new Response("v2") };`);
  const [, next] = await output.waitFor(/url: http:\/\/\S+[\s\S]*url: (http:\/\/\S+)/);

  // The reload updated the server it started, instead of starting another one.
  expect(next).toBe(url);
  expect(await get(url, "/")).toBe("200 v2");
});

test.concurrent("bun bake serves a Hono app exported from app/server.ts, with its Bun WebSockets", async () => {
  using dir = tempDir("bake-command-hono", {
    "app/pages/index.html": `<!doctype html><html><body><h1>Home</h1></body></html>`,
    "app/server.ts": `
      import { Hono } from ${JSON.stringify(require.resolve("hono"))};
      import { createBunWebSocket } from ${JSON.stringify(require.resolve("hono/bun"))};
      const { upgradeWebSocket, websocket } = createBunWebSocket();
      const app = new Hono();
      app.get("/api/hello", c => c.json({ hi: 1 }));
      app.get("/ws", upgradeWebSocket(() => ({ onMessage(event, ws) { ws.send("echo " + event.data); } })));
      // As in \`bun app.ts\`: the Hono app's own keys and its \`routes\` array are not Bun.serve options.
      export default Object.assign(app, { websocket });
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await get(url, "/api/hello")).toBe(`200 {"hi":1}`);
  expect((await get(url, "/")).startsWith("200 ")).toBe(true);

  const ws = new WebSocket(new URL("/ws", url).href.replace("http", "ws"));
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  ws.onopen = () => ws.send("hi");
  ws.onmessage = event => resolve(String(event.data));
  ws.onerror = reject;
  expect(await promise).toBe("echo hi");
  ws.close();
});

test.concurrent.each(["hostname", "host"])("bun bake uses Bun.serve options from the export, with %s", async key => {
  using dir = tempDir("bake-command-options", {
    "app/server.ts": `
      export default {
        ${key}: "127.0.0.1",
        fetch: () => { throw new Error("boom"); },
        error: () => new Response("from the error option", { status: 500 }),
      };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(new URL(url).hostname).toBe("127.0.0.1");
  expect(await get(url, "/")).toBe("500 from the error option");
});

test.concurrent("bun bake accepts a frozen export of app/server.ts", async () => {
  using dir = tempDir("bake-command-frozen", {
    "app/server.ts": `export default Object.freeze({ fetch: () => new Response("frozen") });`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await get(url, "/")).toBe("200 frozen");
});

// Bun.serve's `unix` option takes a socket path, which this test only makes on POSIX.
test.concurrent.skipIf(isWindows)("bun bake keeps a unix socket from the export of app/server.ts", async () => {
  using dir = tempDir("bake-command-unix", {});
  const socket = join(String(dir), "s.sock");
  await Bun.write(
    join(String(dir), "app/server.ts"),
    // `host` does not stop the socket: `bun bake` sets no address for it.
    `export default { unix: ${JSON.stringify(socket)}, host: "localhost", fetch: () => new Response("via unix") };`,
  );

  await using proc = spawnBake(String(dir), ["bake"]);
  const output = collectOutput(proc);
  await output.waitFor(/url: unix:/);

  const res = await fetch("http://localhost/", { unix: socket });
  expect(await res.text()).toBe("via unix");
});

/** The CSS that the page at `path` links to. */
async function getPageCss(url: string, path: string) {
  const html = await (await fetch(new URL(path, url))).text();
  const hrefs = [...html.matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
  const css = await Promise.all(hrefs.map(async href => (await fetch(new URL(href, url))).text()));
  return css.join("\n");
}

test.concurrent("bun bake loads the plugins of bake.config.ts, with those of bunfig.toml", async () => {
  using dir = tempDir("bake-command-config", {
    "bake.config.ts": `
      import { defineConfig } from "bun:bake";
      export default defineConfig(({ mode }) => ({
        plugins: [{
          name: "from-config",
          setup(build) {
            build.onLoad({ filter: /config\\.css$/ }, () => ({ contents: ".config-" + mode + " { color: red; }", loader: "css" }));
          },
        }],
      }));
    `,
    "bunfig.toml": `[serve.static]\nplugins = ["./bunfig-plugin.ts"]\n`,
    "bunfig-plugin.ts": `
      export default {
        name: "from-bunfig",
        setup(build) {
          build.onLoad({ filter: /bunfig\\.css$/ }, () => ({ contents: ".bunfig-plugin { color: red; }", loader: "css" }));
        },
      };
    `,
    "app/config.css": `.unchanged { color: red; }`,
    "app/bunfig.css": `.unchanged { color: red; }`,
    "app/pages/index.html": `<!doctype html><html><head><link rel="stylesheet" href="../config.css" /><link rel="stylesheet" href="../bunfig.css" /></head><body></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const css = await getPageCss(url, "/");
  expect(css).toContain(".config-development");
  expect(css).toContain(".bunfig-plugin");
  expect(css).not.toContain(".unchanged");
});

test.concurrent("bun bake listens on localhost when the export of app/server.ts has an empty hostname", async () => {
  using dir = tempDir("bake-command-empty-hostname", {
    "app/server.ts": `export default { hostname: "", fetch: () => new Response("ok") };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(new URL(url).hostname).toBe("localhost");
});

test.concurrent("bun bake runs a plugin function from bake.config.ts, with the project as its root", async () => {
  using dir = tempDir("bake-command-config-function", {
    "bake.config.ts": `
      function rootPlugin() {}
      rootPlugin.setup = build => {
        const root = build.config.root;
        build.onLoad({ filter: /style\\.css$/ }, () => ({
          contents: (root === process.cwd() ? ".project-root" : ".other-root") + " { color: red; }",
          loader: "css",
        }));
      };
      export default { plugins: [rootPlugin] };
    `,
    "app/style.css": `.unchanged { color: red; }`,
    "app/pages/index.html": `<!doctype html><html><head><link rel="stylesheet" href="../style.css" /></head><body></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await getPageCss(url, "/")).toContain(".project-root");
});

test.concurrent.each([
  { name: "bun --watch bake", args: ["--watch", "bake"] },
  { name: "bun --check --watch bake", args: ["--check", "--watch", "bake"] },
])("$name fails, as bun bake reloads on its own", async ({ args }) => {
  using dir = tempDir("bake-command-watch", { "app/pages/index.html": page });

  await using proc = spawnBake(String(dir), [...args, "--port=0"]);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`"bun bake" reloads app/server.ts on its own. Remove --watch.`);
  expect(stdout).not.toContain("url: ");
  expect(exitCode).toBe(1);
});

test.concurrent("bun bake starts again when bake.config.ts changes, and only then", async () => {
  const config = (cls: string) => `export default {
    plugins: [{
      name: "${cls}",
      setup(build) {
        build.onLoad({ filter: /style\\.css$/ }, () => ({ contents: ".${cls} { color: red; }", loader: "css" }));
      },
    }],
  };`;
  // \`globalThis\` lives through a reload in place, not through a new process: the id tells them apart.
  const server = (version: string) =>
    `globalThis.processId ??= crypto.randomUUID();
    export default { fetch: () => new Response("${version} " + globalThis.processId) };`;
  using dir = tempDir("bake-command-config-change", {
    "bake.config.ts": config("first"),
    "app/server.ts": server("v1"),
    "app/style.css": `.unchanged { color: red; }`,
    "app/pages/index.html": `<!doctype html><html><head><link rel="stylesheet" href="../style.css" /></head><body></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  expect(await getPageCss(url, "/")).toContain(".first");
  const [, , firstId] = (await get(url, "/missing")).split(" ");

  // A change to another file reloads in place, although it evaluates bake.config.ts again.
  await Bun.write(join(String(dir), "app/server.ts"), server("v2"));
  let body = await get(url, "/missing");
  while (!body.includes("v2")) body = await get(url, "/missing");
  expect(body).toBe(`200 v2 ${firstId}`);

  // A change to bake.config.ts starts a new process, which loads the new plugins. A late reload in
  // place can print a URL after the write too, so the new process is the URL that answers with
  // another id. The URL of the old process may not answer at all.
  const before = output.text.length;
  await Bun.write(join(String(dir), "bake.config.ts"), config("second"));
  let next: string;
  let nextBody: string;
  for (let count = 1; ; count++) {
    await output.waitFor(new RegExp(`^[\\s\\S]{${before}}(?:[\\s\\S]*?url: http){${count}}`));
    next = [...output.text.slice(before).matchAll(/url: (http:\/\/\S+)/g)][count - 1][1];
    nextBody = await get(next, "/missing").catch(() => "");
    if (nextBody !== "" && !nextBody.endsWith(firstId)) break;
  }
  expect(nextBody).toStartWith("200 v2 ");
  expect(await getPageCss(next, "/")).toContain(".second");
});

test.concurrent("bun bake runs the SIGTERM handlers before it starts again for bake.config.ts", async () => {
  using dir = tempDir("bake-command-config-sigterm", {
    "bake.config.ts": `export default { plugins: [] };`,
    "app/server.ts": `
      process.on("SIGTERM", () => console.log("SIGTERM before restart"));
      export default { fetch: () => new Response("ok") };
    `,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  await output.waitFor(/url: /);

  await Bun.write(join(String(dir), "bake.config.ts"), `export default { plugins: [] }; // changed`);
  await output.waitFor(/SIGTERM before restart/);
});

// On a terminal, `bun bake` adds its own SIGTERM listener, which exits. Bun.spawn's `terminal` is
// POSIX only.
test.concurrent.skipIf(isWindows)(
  "on a terminal, bun bake runs every SIGTERM listener before it starts again for bake.config.ts",
  async () => {
    const server = (version: string) => `
      process.on("SIGTERM", () => console.log("SIGTERM listener of ${version}"));
      export default { fetch: () => new Response("${version}") };
    `;
    using dir = tempDir("bake-command-config-sigterm-tty", {
      "bake.config.ts": `export default { plugins: [] };`,
      "app/server.ts": server("v1"),
    });

    let text = "";
    let changed = Promise.withResolvers<void>();
    const decoder = new TextDecoder();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "bake", "--port=0"],
      env,
      cwd: String(dir),
      killSignal: "SIGKILL",
      terminal: {
        cols: 200,
        rows: 50,
        data(_terminal, chunk) {
          text += decoder.decode(chunk, { stream: true });
          changed.resolve();
          changed = Promise.withResolvers<void>();
        },
      },
    });
    const waitFor = async (pattern: RegExp) => {
      while (!pattern.test(text)) {
        const exited = await Promise.race([changed.promise.then(() => false), proc.exited.then(() => true)]);
        if (exited && !pattern.test(text)) {
          throw new Error(`Exited with code ${proc.exitCode} before ${pattern}:\n${text}`);
        }
      }
      return text.match(pattern)!;
    };

    const [, url] = await waitFor(/url: (http:\/\/\S+)/);
    // A reload in place adds the listener of v2 after the one of `bun bake`.
    await Bun.write(join(String(dir), "app/server.ts"), server("v2"));
    let body = await get(url, "/");
    while (!body.includes("v2")) body = await get(url, "/");

    await Bun.write(join(String(dir), "bake.config.ts"), `export default { plugins: [] }; // changed`);
    await waitFor(/SIGTERM listener of v2/);
  },
);

test.concurrent("bun bake exits when a start for a bake.config.ts change finds a page it cannot serve", async () => {
  using dir = tempDir("bake-command-config-restart-error", {
    "bake.config.ts": `export default { plugins: [] };`,
    "app/pages/index.html": page,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  await output.waitFor(/url: /);

  // No file that the new process loads could fix the page name, so it exits as at a first start.
  await Bun.write(join(String(dir), "app/pages/[slug].html"), page);
  await Bun.write(join(String(dir), "bake.config.ts"), `export default { plugins: [] }; // changed`);
  await output.waitFor(/a page cannot have/);

  expect(await proc.exited).toBe(1);
});

// Windows has no SIGUSR2.
test.concurrent.skipIf(isWindows)(
  "bun --watch-kill-signal ... bake --check sends that signal before a restart",
  async () => {
    using dir = tempDir("bake-command-kill-signal", {
      "tsconfig.json": checkedTsconfig,
      "app/server.ts": `
      declare const Response: any;
      declare const process: any;
      declare const console: any;
      process.on("SIGUSR2", () => console.log("SIGUSR2 before restart"));
      export default { fetch: () => new Response("v1") };
    `,
    });

    // `--check` starts the process again after a change, which sends the signal: SIGTERM without the flag.
    await using proc = spawnBake(String(dir), ["--watch-kill-signal", "SIGUSR2", "bake", "--check", "--port=0"]);
    const output = collectOutput(proc);
    await output.waitFor(/url: /);

    await Bun.write(
      join(String(dir), "app/server.ts"),
      `declare const Response: any;\nexport default { fetch: () => new Response("v2") };\n`,
    );
    await output.waitFor(/SIGUSR2 before restart/);
  },
);

// Windows has no SIGUSR2.
test.concurrent.skipIf(isWindows)(
  "bun --watch-kill-signal ... bake sends that signal before it starts again for bake.config.ts",
  async () => {
    using dir = tempDir("bake-command-kill-signal-config", {
      "bake.config.ts": `export default { plugins: [] };`,
      "app/server.ts": `
      process.on("SIGUSR2", () => console.log("SIGUSR2 before restart"));
      process.on("SIGTERM", () => console.log("SIGTERM before restart"));
      export default { fetch: () => new Response("ok") };
    `,
    });

    await using proc = spawnBake(String(dir), ["--watch-kill-signal", "SIGUSR2", "bake", "--port=0"]);
    const output = collectOutput(proc);
    await output.waitFor(/url: /);

    await Bun.write(join(String(dir), "bake.config.ts"), `export default { plugins: [] }; // changed`);
    await output.waitFor(/SIGUSR2 before restart/);
    expect(output.text).not.toContain("SIGTERM before restart");
  },
);

test.concurrent("bun bake --port waits for a fix to an option of app/server.ts that Bun.serve rejects", async () => {
  using dir = tempDir("bake-command-bad-option", {
    "app/server.ts": `export default { idleTimeout: 300, fetch: () => new Response("v1") };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  await output.waitFor(/idleTimeout to be 255 or less/);

  await Bun.write(
    join(String(dir), "app/server.ts"),
    `export default { idleTimeout: 30, fetch: () => new Response("v2") };`,
  );
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);

  expect(await get(url, "/")).toBe("200 v2");
});

test.concurrent("bun bake keeps serving when a reload finds a page it cannot serve", async () => {
  using dir = tempDir("bake-command-reload-error", {
    "app/pages/index.html": page,
    "app/server.ts": `export default { fetch: () => new Response("v1") };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);

  // A page that `bun bake` rejects at the start: on a reload, it reports it instead of exiting.
  await Bun.write(join(String(dir), "app/pages/[slug].html"), page);
  await Bun.write(join(String(dir), "app/server.ts"), `export default { fetch: () => new Response("v2") };`);
  await output.waitFor(/a page cannot have/);

  expect(proc.exitCode).toBeNull();
  expect(await get(url, "/missing")).toBe("200 v1");
});

test.concurrent("bun bake reads a bake.config.ts whose default export is a promise", async () => {
  using dir = tempDir("bake-command-config-promise", {
    "bake.config.ts": `
      async function load() {
        return {
          plugins: [{
            name: "from-promise",
            setup(build) {
              build.onLoad({ filter: /style\\.css$/ }, () => ({ contents: ".from-promise { color: red; }", loader: "css" }));
            },
          }],
        };
      }
      export default load();
    `,
    "app/style.css": `.unchanged { color: red; }`,
    "app/pages/index.html": `<!doctype html><html><head><link rel="stylesheet" href="../style.css" /></head><body></body></html>`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  expect(await getPageCss(url, "/")).toContain(".from-promise");
});

// On Windows, a manager process starts each restart with its own environment, so a restart cannot
// tell it is one, and exits on this error as at the first start.
test.concurrent.skipIf(isWindows)(
  "bun bake --check waits for a fix when a restart finds a page it cannot serve",
  async () => {
    using dir = tempDir("bake-command-check-restart-error", {
      "tsconfig.json": checkedTsconfig,
      "app/pages/index.html": page,
      "app/server.ts": `declare const Response: any;\nexport default { fetch: () => new Response("v1") };\n`,
    });

    await using proc = spawnBake(String(dir), ["bake", "--check", "--port=0"]);
    const output = collectOutput(proc);
    await output.waitFor(/url: /);

    // `--check` starts the process again on a change: the error must not end the session.
    const slug = join(String(dir), "app/pages/[slug].html");
    await Bun.write(slug, page);
    await Bun.write(
      join(String(dir), "app/server.ts"),
      `declare const Response: any;\nexport default { fetch: () => new Response("v2") };\n`,
    );
    await output.waitFor(/a page cannot have/);

    rmSync(slug);
    await Bun.write(
      join(String(dir), "app/server.ts"),
      `declare const Response: any;\nexport default { fetch: () => new Response("v3") };\n`,
    );
    const [, url] = await output.waitFor(/a page cannot have[\s\S]*url: (http:\/\/\S+)/);

    expect(await get(url, "/missing")).toBe("200 v3");
  },
);

test.concurrent.each([
  { name: "nothing to serve", files: { "README.md": "" }, error: "Nothing to serve in" },
  { name: "a page it cannot serve", files: { "app/pages/[slug].html": page }, error: "a page cannot have" },
])("bun bake --check exits at the start on $name", async ({ files, error }) => {
  // `lib.ts` gives the type checker an input, so the check passes and `bun bake` runs.
  using dir = tempDir("bake-command-check-first-error", {
    "tsconfig.json": checkedTsconfig,
    "lib.ts": `export const one: number = 1;`,
    ...files,
  });

  await using proc = spawnBake(String(dir), ["bake", "--check", "--port=0"]);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(error);
  expect(stdout).not.toContain("url: ");
  expect(exitCode).toBe(1);
});

// On Windows, a restart cannot tell it is one, as above.
test.concurrent.skipIf(isWindows)(
  "bun bake --check waits on a restart error also when the first start had a type error",
  async () => {
    using dir = tempDir("bake-command-check-typeerror-restart", {
      "tsconfig.json": checkedTsconfig,
      "app/pages/[slug].html": page,
      "app/server.ts": `declare const Response: any;\nconst n: number = "x";\nexport default { fetch: () => new Response("v1") };\n`,
    });

    await using proc = spawnBake(String(dir), ["bake", "--check", "--port=0"]);
    const output = collectOutput(proc);
    await output.waitFor(/TS2322/);

    // The fix restarts the process, which then finds the page it cannot serve: it must wait.
    await Bun.write(
      join(String(dir), "app/server.ts"),
      `declare const Response: any;\nexport default { fetch: () => new Response("v2") };\n`,
    );
    await output.waitFor(/a page cannot have/);

    rmSync(join(String(dir), "app/pages/[slug].html"));
    await Bun.write(
      join(String(dir), "app/server.ts"),
      `declare const Response: any;\nexport default { fetch: () => new Response("v3") };\n`,
    );
    const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);

    expect(await get(url, "/missing")).toBe("200 v3");
  },
);

/** Links the React of the test suite into a project in `dir`. A junction needs no privilege on Windows. */
function linkReact(dir: string) {
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(dir, "node_modules"), "junction");
}

test.concurrent(
  "bun bake renders .tsx pages, with layouts and params, next to .html pages and app/server.ts",
  async () => {
    using dir = tempDir("bake-command-tsx", {
      "app/pages/index.tsx": `export default function Home() { return <h1>Home</h1>; }`,
      "app/pages/blog/[slug].tsx": `export default function Post({ params }) { return <h1>{"Post " + params.slug}</h1>; }`,
      "app/pages/_layout.tsx": `export default function Layout({ children }) { return <main className="layout">{children}</main>; }`,
      "app/pages/about.html": `<!doctype html><html><body><h1>About</h1></body></html>`,
      "app/server.ts": `
      export default {
        routes: { "/api/hello": () => Response.json({ hi: 1 }) },
        fetch: () => new Response("fallback", { status: 404 }),
      };
    `,
    });
    linkReact(String(dir));

    await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
    const url = await getServerUrl(proc);

    const home = await (await fetch(new URL("/", url))).text();
    expect(home).toContain(`<main class="layout"><h1>Home</h1></main>`);
    const post = await (await fetch(new URL("/blog/hello", url))).text();
    expect(post).toContain(`<h1>Post hello</h1>`);
    expect(post).toContain(
      `<script id="__bun_bake_data" type="application/json">{"params":{"slug":"hello"},"props":{},"hasData":false}</script>`,
    );
    expect(await (await fetch(new URL("/about", url))).text()).toContain("<h1>About</h1>");
    expect(await get(url, "/api/hello")).toBe(`200 {"hi":1}`);
    expect(await get(url, "/missing")).toBe("404 fallback");
  },
);

test.concurrent.each([
  {
    name: "React is not installed",
    packages: {},
    error: "app/pages/ has .tsx pages, which need React. Install it: bun add react react-dom",
  },
  {
    name: "React is too old",
    packages: { react: "17.0.2", "react-dom": "17.0.2" },
    error: `"bun bake" renders .tsx pages with React 18 or newer, but this project has react 17.0.2. Upgrade React.`,
  },
  {
    name: "react and react-dom differ",
    packages: { react: "19.0.0", "react-dom": "18.3.1" },
    error:
      "react 19.0.0 and react-dom 18.3.1 must be the same version. Install matching versions: bun add react@19.0.0 react-dom@19.0.0",
  },
])("bun bake exits when $name", async ({ packages, error }) => {
  const files: Record<string, string> = {
    "app/pages/index.tsx": `export default function Home() { return <h1>Home</h1>; }`,
    // With a package.json and node_modules, Bun does not install missing packages on the fly.
    "package.json": `{}`,
    "node_modules/.keep": "",
  };
  for (const [name, version] of Object.entries(packages)) {
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version });
  }
  using dir = tempDir("bake-command-react-version", files);

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe(`error: ${error}`);
  expect(stdout).not.toContain("url: ");
  expect(exitCode).toBe(1);
});

test.concurrent("bun bake routes and renders pages with the framework of a bake.config.ts plugin", async () => {
  using dir = tempDir("bake-command-framework", {
    // No React, and its own folder and extension: the framework routes and renders the pages.
    "src/routes/index.ts": `export default () => "home";`,
    "src/routes/[id].ts": `export default params => "page " + params.id;`,
    // Not a page of this framework.
    "app/pages/other.tsx": `export default () => "other";`,
    "render/server.ts": `
      export function render(request, meta) {
        const body = meta.pageModule.default(meta.params ?? {}) + " " + JSON.stringify(meta.modules);
        return new Response(body, { headers: { "content-type": "text/plain" } });
      }
    `,
    "bake.config.ts": `export default {
      plugins: [{
        name: "strings",
        framework: {
          fileSystemRouterTypes: [{ root: "src/routes", style: "nextjs-pages", serverEntryPoint: "./render/server.ts", extensions: [".ts"] }],
        },
      }],
    };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  // A framework with no client entry point has no browser bundle.
  expect(await get(url, "/")).toBe("200 home []");
  expect(await get(url, "/7")).toBe("200 page 7 []");
  expect(await get(url, "/other")).toBe("200 page other []");
});

test.concurrent("a framework with clientPages puts the pages of a route in its browser bundle", async () => {
  using dir = tempDir("bake-command-client-pages", {
    "app/pages/index.ts": `export default () => "home-page-module";`,
    "app/pages/about.ts": `export default () => "about-page-module";`,
    "render/server.ts": `export function render(request, meta) { return new Response(meta.modules.join(" ")); }`,
    "render/client.ts": `import { route } from "bun:bake/client"; route.page();`,
    "bake.config.ts": `export default {
      plugins: [{
        name: "fw",
        framework: {
          fileSystemRouterTypes: [{
            root: "app/pages",
            style: "nextjs-pages",
            serverEntryPoint: "./render/server.ts",
            clientEntryPoint: "./render/client.ts",
            extensions: [".ts"],
            clientPages: true,
          }],
        },
      }],
    };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const [, bundleUrl] = (await get(url, "/")).split(" ");
  const bundle = await (await fetch(new URL(bundleUrl, url))).text();
  expect(bundle).toContain(`route: { page: "app/pages/index.ts", layouts: [] }`);
  expect(bundle).toContain("home-page-module");
  expect(bundle).not.toContain("about-page-module");
});

test.concurrent("the browser build of a page leaves out the serverExports of its framework", async () => {
  using dir = tempDir("bake-command-server-exports", {
    "app/secret.js": `export const secret = "server-only-secret";`,
    // `getServerSideProps` is not a server export of this framework, so it stays.
    "app/pages/index.js": `
      import { secret } from "../secret.js";
      export const loader = () => secret.length;
      export const getServerSideProps = () => "kept-export";
      export default () => "home-page-module";
    `,
    "render/server.ts": `export function render(request, meta) {
      return new Response(meta.pageModule.loader() + " " + meta.modules.join(" "));
    }`,
    "render/client.ts": `import { route } from "bun:bake/client"; route.page();`,
    "bake.config.ts": `export default {
      plugins: [{
        name: "fw",
        framework: {
          fileSystemRouterTypes: [{
            root: "app/pages",
            style: "nextjs-pages",
            serverEntryPoint: "./render/server.ts",
            clientEntryPoint: "./render/client.ts",
            extensions: [".js"],
            clientPages: { serverExports: ["loader"] },
          }],
        },
      }],
    };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  // The server still has the loader.
  const [status, length, bundleUrl] = (await get(url, "/")).split(" ");
  expect(status).toBe("200");
  expect(length).toBe("18");
  const bundle = await (await fetch(new URL(bundleUrl, url))).text();
  expect(bundle).toContain("home-page-module");
  expect(bundle).toContain("kept-export");
  expect(bundle).not.toContain("server-only-secret");
});

test.concurrent("bun bake sends a page's new code to a page load after an edit", async () => {
  using dir = tempDir("bake-command-page-edit", {
    "app/pages/index.tsx": `export default function Home() { return <h1>{"first-version"}</h1>; }`,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);
  const bundle = async () => {
    const html = await (await fetch(url)).text();
    // While the edit is written, the file can be empty for a moment, and the page an error with no script.
    const src = html.match(/<script type="module" src="([^"]+)"/)?.[1];
    return src === undefined ? "" : await (await fetch(new URL(src, url))).text();
  };
  expect(await bundle()).toContain("first-version");

  await Bun.write(
    join(String(dir), "app/pages/index.tsx"),
    `export default function Home() { return <h1>{"second-version"}</h1>; }`,
  );
  // Until the dev server has the edit. Before, it served the bundle it made before the edit.
  let code = await bundle();
  for (let i = 0; i < 200 && !code.includes("second-version"); i++) code = await bundle();
  expect(code).not.toContain("first-version");
});

test.concurrent("bun bake starts again for the first .tsx page, at the next reload", async () => {
  using dir = tempDir("bake-command-first-page", {
    "app/pages/index.html": page,
    "app/server.ts": `export default { fetch: () => new Response("fallback") };`,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  expect(await get(url, "/about")).toBe("200 fallback");

  await Bun.write(join(String(dir), "app/pages/about.tsx"), `export default () => <h1>about</h1>;`);
  // A new file in app/pages/ does not reload; an edit to app/server.ts does.
  const before = output.text.length;
  await Bun.write(join(String(dir), "app/server.ts"), `export default { fetch: () => new Response("fallback 2") };`);
  await output.waitFor(new RegExp(`^[\\s\\S]{${before}}[\\s\\S]*url: http`));
  const next = output.text.slice(before).match(/url: (http:\/\/\S+)/)![1];
  expect(await (await fetch(new URL("/about", next))).text()).toContain("<h1>about</h1>");
});

test.concurrent("bun bake renders pages and layouts made with memo() and forwardRef()", async () => {
  using dir = tempDir("bake-command-memo", {
    "app/pages/index.tsx": `
      import { memo } from "react";
      export default memo(function Home() { return <h1>memo page</h1>; });
    `,
    "app/pages/_layout.tsx": `
      import { forwardRef } from "react";
      export default forwardRef(function Layout({ children }, ref) { return <main ref={ref}>{children}</main>; });
    `,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);
  expect(await (await fetch(url)).text()).toContain("<main><h1>memo page</h1></main>");
});

test.concurrent("bun bake rejects a route with dir and style in app/server.ts", async () => {
  using dir = tempDir("bake-command-dir-style", {
    "app/pages/index.ts": `export default () => "x";`,
    "r.ts": `export function render() { return new Response("x"); }`,
    "bake.config.ts": `export default { plugins: [{ name: "fw", framework: { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./r.ts", extensions: [".ts"] }] } }] };`,
    "app/server.ts": `export default { routes: { "/x/*": { dir: "app/x", style: "nextjs-pages" } } };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  await output.waitFor(/does not support a route with "dir" and "style"/);
  expect(output.text).not.toContain("url: ");
});

test.concurrent("bun bake runs the data functions of a page of the default framework", async () => {
  using dir = tempDir("bake-command-page-data", {
    "app/secret.ts": `export const secret = "server-only-secret";`,
    "app/pages/dashboard.tsx": `
      import { secret } from "../secret.ts";
      export const getServerSideProps = async ({ request }) => {
        const user = request.headers.get("x-user");
        if (user === "gone") return { notFound: true };
        if (!user) return { redirect: { destination: "/", permanent: false } };
        return { props: { user, length: secret.length } };
      };
      export default function Dashboard({ user, length }) {
        return <h1>{"Hi " + user + " " + length}</h1>;
      }
    `,
    "app/pages/blog/[id].tsx": `
      export const getStaticPaths = async () => ({ paths: [{ params: { id: "1" } }], fallback: false });
      export const getStaticProps = async ({ params }) => ({ props: { title: "Post " + params.id } });
      export default function Post({ title }) {
        return <h1>{title}</h1>;
      }
    `,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const page = await fetch(new URL("/dashboard", url), { headers: { "x-user": "ali" } });
  const html = await page.text();
  expect(html).toContain("<h1>Hi ali 18</h1>");
  expect(html).toContain(`"props":{"user":"ali","length":18},"hasData":true`);

  const redirect = await fetch(new URL("/dashboard", url), { redirect: "manual" });
  expect([redirect.status, redirect.headers.get("location")]).toEqual([307, "/"]);
  expect((await fetch(new URL("/dashboard", url), { headers: { "x-user": "gone" } })).status).toBe(404);

  expect(await (await fetch(new URL("/blog/1", url))).text()).toContain("<h1>Post 1</h1>");
  // Not in getStaticPaths, with `fallback: false`.
  expect((await fetch(new URL("/blog/2", url))).status).toBe(404);

  // The browser copy of the page has no getServerSideProps, and so no import of app/secret.ts.
  const bundleUrl = html.match(/<script type="module" src="([^"]+)"/)![1];
  const bundle = await (await fetch(new URL(bundleUrl, url))).text();
  expect(bundle).toContain("app/pages/dashboard.tsx");
  expect(bundle).not.toContain("getServerSideProps");
  expect(bundle).not.toContain("server-only-secret");
});

test.concurrent("the default framework sends the browser bundle before a slow Suspense boundary", async () => {
  using dir = tempDir("bake-command-bootstrap", {
    // The boundary waits until the test requests /release.
    "app/server.ts": `
      globalThis.gate ??= Promise.withResolvers();
      export default { routes: { "/release": () => { globalThis.gate.resolve(); globalThis.released = true; return new Response("ok"); } } };
    `,
    "app/pages/index.tsx": `
      import { Suspense } from "react";
      function Late() {
        if (!globalThis.released) throw globalThis.gate.promise;
        return <p>late content</p>;
      }
      export default () => <Suspense fallback={<p>loading</p>}><Late /></Suspense>;
    `,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);
  const response = await fetch(url);
  const decoder = new TextDecoder();
  let html = "";
  const reader = response.body!.getReader();
  while (!html.includes('src="/_bun/client/')) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  // The browser can start hydrating while the boundary is still pending.
  expect(html).toContain('src="/_bun/client/');
  expect(html).not.toContain("late content");

  await fetch(new URL("/release", url));
  for (let r = await reader.read(); !r.done; r = await reader.read()) html += decoder.decode(r.value, { stream: true });
  expect(html).toContain("late content");
});

test.concurrent(
  "bun bake keeps an unused import of a page in the browser, and drops the imports of getStaticProps and getStaticPaths",
  async () => {
    using dir = tempDir("bake-command-page-data-static", {
      "app/secret.js": `export const secret = "server-only-secret";`,
      "app/paths.js": `export const paths = ["only-for-paths"];`,
      "app/register.js": `globalThis.registered = "side-effect-kept"; export default 1;`,
      "app/pages/[slug].jsx": `
      import { secret } from "../secret.js";
      import { paths } from "../paths.js";
      import registered from "../register.js";
      export const getStaticPaths = async () => ({ paths: paths.map(slug => ({ params: { slug } })), fallback: "blocking" });
      export const getStaticProps = async ({ params }) => ({ props: { length: secret.length } });
      export default function Post({ length }) {
        return <h1>{"length " + length}</h1>;
      }
    `,
    });
    linkReact(String(dir));

    await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
    const url = await getServerUrl(proc);

    const html = await (await fetch(new URL("/x", url))).text();
    expect(html).toContain("<h1>length 18</h1>");
    const bundleUrl = html.match(/<script type="module" src="([^"]+)"/)![1];
    const bundle = await (await fetch(new URL(bundleUrl, url))).text();
    expect(bundle).not.toContain("server-only-secret");
    expect(bundle).not.toContain("only-for-paths");
    expect(bundle).toContain("side-effect-kept");
  },
);

test.concurrent("bun bake leaves the server-only imports of a .jsx page out of its browser bundle", async () => {
  using dir = tempDir("bake-command-page-data-jsx", {
    "app/secret.js": `export const secret = "server-only-secret";`,
    "app/pages/index.jsx": `
      import { secret } from "../secret.js";
      export const getServerSideProps = async () => ({ props: { length: secret.length } });
      export default function Home({ length }) {
        return <h1>{"length " + length}</h1>;
      }
    `,
  });
  linkReact(String(dir));

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const url = await getServerUrl(proc);

  const html = await (await fetch(url)).text();
  expect(html).toContain("<h1>length 18</h1>");
  const bundleUrl = html.match(/<script type="module" src="([^"]+)"/)![1];
  const bundle = await (await fetch(new URL(bundleUrl, url))).text();
  expect(bundle).toContain("app/pages/index.jsx");
  expect(bundle).not.toContain("server-only-secret");
});

test.concurrent("bun bake reports a page that a route of app/server.ts hides", async () => {
  using dir = tempDir("bake-command-hidden-page", {
    "app/pages/index.ts": `export default () => "page-index";`,
    "app/pages/about.ts": `export default () => "page-about";`,
    "render/server.ts": `export function render(request, meta) { return new Response(meta.pageModule.default()); }`,
    "bake.config.ts": `export default { plugins: [{ name: "fw", framework: { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./render/server.ts", extensions: [".ts"] }] } }] };`,
    "app/server.ts": `export default { routes: { "/about": () => new Response("route-about") } };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  await output.waitFor(/The server has a route "\/about", which hides the page app\/pages\/about\.ts/);

  // It keeps serving: the route answers, and the other page too.
  expect(await get(url, "/about")).toBe("200 route-about");
  expect(await get(url, "/")).toBe("200 page-index");
});

test.concurrent("bun bake reports two pages with the same URL pattern, and keeps serving", async () => {
  using dir = tempDir("bake-command-aliased", {
    "app/pages/[a].tsx": `export default () => "a";`,
    "app/pages/[b].tsx": `export default () => "b";`,
    "render/server.ts": `export function render(request, meta) { return new Response(meta.pageModule.default()); }`,
    "bake.config.ts": `export default { plugins: [{ name: "strings", framework: { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./render/server.ts" }] } }] };`,
  });

  await using proc = spawnBake(String(dir), ["bake", "--port=0"]);
  const output = collectOutput(proc);
  const [, url] = await output.waitFor(/url: (http:\/\/\S+)/);
  // The router reports the collision when it scans, at the first request.
  expect((await get(url, "/x")).startsWith("200 ")).toBe(true);
  await output.waitFor(/Multiple pages matching the same route pattern is ambiguous/);

  expect(output.text).toContain("app/pages/[a].tsx");
  expect(output.text).toContain("app/pages/[b].tsx");
  expect(proc.exitCode).toBeNull();
});

/** Runs `bun dist/server.js` in `dir` on a free port, and returns its URL. */
async function startBuild(
  dir: string,
  server = "dist/server.js",
  extraEnv: Record<string, string> = {},
  listening = /Listening on (https?:\/\/\S+)/,
) {
  const proc = Bun.spawn({
    cmd: [bunExe(), server],
    env: { ...env, PORT: "0", ...extraEnv },
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk, { stream: true });
    const url = text.match(listening)?.[1];
    if (url) return { proc, url };
  }
  throw new Error("dist/server.js exited: " + text + (await proc.stderr.text()));
}

test.concurrent("bun bake build builds the pages and app/server.ts into dist/server.js", async () => {
  using dir = tempDir("bake-build", {
    "app/secret.ts": `export const secret = "server-only-secret";`,
    "app/pages/_layout.tsx": `
      import "./site.css";
      export default function Layout({ children }) { return <main className="layout">{children}</main>; }
    `,
    "app/pages/site.css": `.layout { color: rebeccapurple; }`,
    "app/pages/index.tsx": `export default function Home() { return <h1>{"home"}</h1>; }`,
    "app/pages/counter.tsx": `
      import { secret } from "../secret.ts";
      let renders = 0;
      export const getServerSideProps = async () => ({ props: { renders: ++renders, length: secret.length } });
      export default function Counter({ renders, length }) { return <p>{"ssr " + renders + " " + length}</p>; }
    `,
    "app/pages/blog/[slug].tsx": `
      let renders = 0;
      export const getStaticPaths = async () => ({ paths: [{ params: { slug: "a" } }], fallback: "blocking" });
      export const getStaticProps = async ({ params }) => ({ props: { slug: params.slug, renders: ++renders } });
      export default function Post({ slug, renders }) { return <p>{"post " + slug + " " + renders}</p>; }
    `,
    "app/server.ts": `export default { routes: { "/api/ping": () => new Response("pong") } };`,
    "public/robots.txt": "from-public",
  });
  linkReact(String(dir));

  await using build = spawnBake(String(dir), ["bake", "build"]);
  const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).toBe("");
  expect(buildOut).toContain("Built 3 pages into dist/");
  expect(buildExit).toBe(0);

  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const text = async (path: string) => (await get(url, path)).replaceAll("<!-- -->", "");

  const home = await text("/");
  expect(home).toContain(`<main class="layout"><h1>home</h1></main>`);
  const [, script] = home.match(/<script type="module" src="(\/_bun\/[^"]+\.js)"/) ?? [];
  const [, style] = home.match(/<link rel="stylesheet" href="(\/_bun\/[^"]+\.css)"/) ?? [];
  expect(await get(url, style)).toContain(".layout{color:#639}");

  // getServerSideProps renders on each request; getStaticProps once per path, also for a path
  // that getStaticPaths did not list (fallback: "blocking").
  expect(await text("/counter")).toContain("<p>ssr 1 18</p>");
  expect(await text("/counter")).toContain("<p>ssr 2 18</p>");
  expect(await text("/blog/a")).toContain("<p>post a 1</p>");
  expect(await text("/blog/a")).toContain("<p>post a 1</p>");
  expect(await text("/blog/b")).toContain("<p>post b 2</p>");

  expect(await get(url, "/api/ping")).toBe("200 pong");
  expect(await get(url, "/robots.txt")).toBe("200 from-public");

  // The browser code of a page has no data function and none of the server-only imports.
  const counterScript = (await text("/counter")).match(/<script type="module" src="(\/_bun\/[^"]+\.js)"/)![1];
  const browserCode = (await get(url, script)) + (await get(url, counterScript));
  expect(browserCode).not.toContain("server-only-secret");
  expect(browserCode).not.toContain("getServerSideProps");
});

async function buildApp(dir: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  await using build = spawnBake(dir, ["bake", "build", ...args], extraEnv);
  const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each([[1], [true]])(
  "bun bake build keeps a page with revalidate: %p for a second",
  async revalidate => {
    using dir = tempDir("bake-build-revalidate", {
      "app/pages/index.tsx": `
      let renders = 0;
      export const getStaticProps = async () => ({ props: { renders: ++renders }, revalidate: ${revalidate} });
      export default function Home({ renders }) { return <p>{"render " + renders}</p>; }
    `,
    });
    linkReact(String(dir));

    const build = await buildApp(String(dir));
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const { proc, url } = await startBuild(String(dir));
    await using _ = proc;
    const text = async () => (await get(url, "/")).replaceAll("<!-- -->", "");

    expect(await text()).toContain("render 1");
    expect(await text()).toContain("render 1");
    // After a second the kept page is sent once more while it renders again, then the new one.
    let latest = "";
    while (!latest.includes("render 2")) latest = await text();
    expect(latest).toContain("render 2");
  },
);

const hydrateInHappyDom = `
  import { GlobalRegistrator } from "happy-dom-registrator";
  import { join } from "node:path";
  const [url, buttonText] = process.argv.slice(2);
  const html = await (await fetch(url)).text();
  const script = html.match(/<script type="module" src="(\\/_bun\\/[^"]+\\.js)"/)[1];
  // The browser asks the server for the files of the build, which are in dist/client/.
  Bun.plugin({
    name: "browser-urls",
    setup(build) {
      build.onResolve({ filter: /^\\/_bun\\// }, args => ({ path: join(import.meta.dir, "dist/client", args.path) }));
    },
  });
  // The import below runs the script. happy-dom's own module loader cannot read import.meta.
  GlobalRegistrator.register({
    url,
    settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
  });
  document.write(html);
  import(join(import.meta.dir, "dist/client", script));
  while (document.querySelector("button").textContent !== buttonText) {
    document.querySelector("button").click();
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("hydrated " + document.querySelector("button").textContent);
  process.exit(0);
`;

test.concurrent("bun bake build hydrates a page in the browser, and serves its files", async () => {
  using dir = tempDir("bake-build-hydrate", {
    "app/pages/_layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
    "app/pages/index.tsx": `
      import { useState } from "react";
      import logo from "./logo.png";
      export default function Home() {
        const [count, setCount] = useState(0);
        return <button data-logo={logo} onClick={() => setCount(count + 1)}>{"home " + count}</button>;
      }
    `,
    "app/pages/other.tsx": `
      import { useState } from "react";
      export const getStaticProps = async () => ({ props: { name: "other" } });
      export default function Other({ name }) {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>{name + " " + count}</button>;
      }
    `,
    "app/pages/logo.png": "not-really-a-png",
    "public/.well-known/security.txt": "dotfile",
    "hydrate.mjs": hydrateInHappyDom.replace('"happy-dom-registrator"', () =>
      JSON.stringify(join(import.meta.dir, "../../node_modules/@happy-dom/global-registrator/lib/index.js")),
    ),
  });
  linkReact(String(dir));

  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  for (const [path, text] of [
    ["/", "home 1"],
    ["/other", "other 1"],
  ]) {
    await using browser = Bun.spawn({
      cmd: [bunExe(), "hydrate.mjs", new URL(path, url).href, text],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      browser.stdout.text(),
      browser.stderr.text(),
      browser.exited,
    ]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: `hydrated ${text}`,
      stderr: "",
      exitCode: 0,
    });
  }

  // The HTML and the browser code name the same file, and the server has it.
  const [, logo] = (await get(url, "/")).match(/data-logo="([^"]+)"/)!;
  expect(logo).toMatch(/^\/_bun\/logo-\w+\.png$/);
  expect(await get(url, logo)).toBe("200 not-really-a-png");
  expect(await get(url, "/.well-known/security.txt")).toBe("200 dotfile");
});

test.concurrent("bun bake build only removes a folder that holds a build", async () => {
  using dir = tempDir("bake-build-outdir", {
    "server.js": `// the project's own`,
    "app/server.js": `export default { routes: { "/api": () => new Response("api") } };`,
    "app/pages/index.tsx": `export default function Home() { return <h1>{"home"}</h1>; }`,
    "other/keep.txt": "keep",
  });
  linkReact(String(dir));
  const root = String(dir);

  for (const outdir of [".", "app", "other", ".."]) {
    const { stdout, exitCode } = await buildApp(root, ["--outdir", outdir]);
    expect({ outdir, stdout, exitCode }).toEqual({ outdir, stdout: "", exitCode: 1 });
  }
  // Not even with the file that marks a build.
  writeFileSync(join(root, ".bun-bake-build"), "");
  expect((await buildApp(root, ["--outdir", "."])).exitCode).toBe(1);
  rmSync(join(root, ".bun-bake-build"));
  expect(readFileSync(join(root, "server.js"), "utf8")).toBe(`// the project's own`);
  expect(existsSync(join(root, "app/pages/index.tsx"))).toBe(true);
  expect(readFileSync(join(root, "other/keep.txt"), "utf8")).toBe("keep");

  // A build, then one that fails, then one more: each starts from what the last one left.
  expect((await buildApp(root)).exitCode).toBe(0);
  writeFileSync(join(root, "dist/stale.txt"), "stale");
  writeFileSync(join(root, "app/pages/broken.tsx"), `import "./does-not-exist.ts";`);
  const failed = await buildApp(root);
  expect(failed.stderr).toContain("does-not-exist");
  expect(failed.exitCode).toBe(1);
  rmSync(join(root, "app/pages/broken.tsx"));
  expect((await buildApp(root)).exitCode).toBe(0);
  expect(existsSync(join(root, "dist/stale.txt"))).toBe(false);
  expect(existsSync(join(root, "dist/server.js"))).toBe(true);
});

test.concurrent("bun bake build refuses an outdir that holds a project in a folder named ..name", async () => {
  using dir = tempDir("bake-build-dotdot", {
    ".bun-bake-build": "",
    "..apps/site/app/server.js": `export default { routes: { "/api": () => new Response("api") } };`,
  });
  const root = String(dir);
  const project = join(root, "..apps/site");

  const { stderr, exitCode } = await buildApp(project, ["--outdir", root]);
  expect(stderr).toContain("holds the project");
  expect(existsSync(join(project, "app/server.js"))).toBe(true);
  expect(exitCode).toBe(1);
});

test.concurrent("bun bake build renders a kept page once for requests at the same time, and not for HEAD", async () => {
  using dir = tempDir("bake-build-keep", {
    "app/pages/shared.tsx": `
      let renders = 0;
      export const getStaticProps = async () => {
        const render = ++renders;
        await Bun.sleep(200);
        return { props: { render } };
      };
      export default function Page({ render }) { return <p>{"render " + render}</p>; }
    `,
    "app/pages/head.tsx": `
      let renders = 0;
      export const getStaticProps = async () => ({ props: { render: ++renders } });
      export default function Page({ render }) { return <p>{"render " + render}</p>; }
    `,
    // Each response depends on the request, so requests at the same time do not share one.
    "app/pages/session.tsx": `
      export const getServerSideProps = async ({ request }) => {
        await Bun.sleep(100);
        return { props: { user: request.headers.get("x-user") } };
      };
      export default function Page({ user }) { return <p>{"user " + user}</p>; }
    `,
    "app/pages/bad-revalidate.tsx": `
      export const getStaticProps = async () => ({ props: {}, revalidate: 1.5 });
      export default function Page() { return <p>page</p>; }
    `,
  });
  linkReact(String(dir));
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const text = async (path: string) => (await get(url, path)).replaceAll("<!-- -->", "");

  const shared = await Promise.all([text("/shared"), text("/shared"), text("/shared")]);
  expect(shared.map(page => page.match(/render \d+/)?.[0])).toEqual(["render 1", "render 1", "render 1"]);

  // A HEAD renders, but what it renders is not kept for GET. Then a HEAD gets what a GET kept.
  const head = await fetch(new URL("/head", url), { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await text("/head")).toContain("render 2");
  expect(await text("/head")).toContain("render 2");
  const headOfKept = await fetch(new URL("/head", url), { method: "HEAD" });
  expect(headOfKept.status).toBe(200);
  expect(await headOfKept.text()).toBe("");

  const users = await Promise.all(
    ["a", "b"].map(async user => {
      const res = await fetch(new URL("/session", url), { headers: { "x-user": user } });
      return (await res.text()).replaceAll("<!-- -->", "").match(/user \w+/)?.[0];
    }),
  );
  expect(users).toEqual(["user a", "user b"]);

  expect((await fetch(new URL("/bad-revalidate", url))).status).toBe(500);
});

test.concurrent("bun bake build renders a kept page again until it can, and drops one it cannot keep", async () => {
  using dir = tempDir("bake-build-rerender", {
    "app/pages/index.tsx": `
      let renders = 0;
      export const getStaticProps = async () => {
        const render = ++renders;
        if (render === 2) throw new Error("a failed render");
        if (render > 2) return { notFound: true };
        return { props: { render }, revalidate: 1 };
      };
      export default function Home({ render }) { return <p>{"render " + render}</p>; }
    `,
  });
  linkReact(String(dir));
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const text = async () => (await get(url, "/")).replaceAll("<!-- -->", "");

  expect(await text()).toContain("render 1");
  // The second render fails, and the kept page stays until the next one. The third is not a page,
  // so the kept page goes, and the next request gets what its own render gives.
  let latest = "";
  while (!latest.startsWith("404")) latest = await text();
  expect(latest).toBe("404 Not Found");
});

test.concurrent("bun bake build keeps a page in full when the client goes away during the render", async () => {
  using dir = tempDir("bake-build-disconnect", {
    "app/gate.ts": `export const started = Promise.withResolvers(), gate = Promise.withResolvers();`,
    "app/server.ts": `
      import { gate, started } from "./gate.ts";
      export default {
        routes: {
          "/started": async () => (await started.promise, new Response("started")),
          "/open": () => (gate.resolve(), new Response("open")),
        },
      };
    `,
    "app/pages/index.tsx": `
      import { lazy, Suspense } from "react";
      import { gate, started } from "../gate.ts";
      const Loaded = lazy(async () => {
        started.resolve();
        await gate.promise;
        return { default: () => <p>loaded</p> };
      });
      export default function Home() {
        return <Suspense fallback={<p>waiting</p>}><Loaded /></Suspense>;
      }
    `,
  });
  linkReact(String(dir));
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  const client = new AbortController();
  const gone = fetch(new URL("/", url), { signal: client.signal }).catch(error => error.name);
  expect(await get(url, "/started")).toBe("200 started");
  client.abort();
  expect(await gone).toBe("AbortError");
  // The server handles this request after the close of the connection that went away.
  expect(await get(url, "/started")).toBe("200 started");

  const next = fetch(new URL("/", url)).then(res => res.text());
  expect(await get(url, "/open")).toBe("200 open");
  expect(await next).toContain("loaded");
  expect(await get(url, "/")).toContain("loaded");
});

/** A framework of `bake.config.ts`, which sets only what it must: the rest is the dev server's defaults. */
const frameworkFiles = {
  "bake.config.ts": `
    export default {
      plugins: [
        {
          name: "framework",
          framework: {
            fileSystemRouterTypes: [
              {
                root: "routes",
                style: "nextjs-app-ui",
                serverEntryPoint: "./render/server.ts",
                clientEntryPoint: "./render/client.ts",
                clientPages: { serverExports: ["serverOnly"] },
              },
            ],
          },
          setup(build) {
            build.onLoad({ filter: /routes.client.page\\.tsx$/ }, async args => ({
              contents: (await Bun.file(args.path).text()).replace("BEFORE_PLUGIN", "after-plugin"),
              loader: "tsx",
            }));
          },
        },
      ],
    };
  `,
  "bunfig.toml": `[serve.static]\nplugins = ["./bunfig-plugin.ts"]\n`,
  "bunfig-plugin.ts": `
    export default {
      name: "from-bunfig",
      setup(build) {
        build.onLoad({ filter: /from-bunfig\\.js$/ }, () => ({ contents: "globalThis.seen = 'bunfig-plugin-ran';", loader: "js" }));
      },
    };
  `,
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "globalThis.projectJsx" } }),
  "render/server.ts": `
    let renders = 0;
    export function render(request, meta) {
      const render = ++renders;
      const headers = { "x-render": String(render) };
      if (meta.pageModule.big) {
        return new Response(Buffer.alloc(8 * 1024 * 1024), { headers: { ...headers, "cache-control": "s-maxage=1000" } });
      }
      return Response.json({ params: meta.params, layouts: meta.layouts.length, modules: meta.modules }, { headers });
    }
  `,
  "render/client.ts": `import { route } from "bun:bake/client"; await route.page();`,
  "routes/page.ts": `export default "home";`,
  "routes/layout.ts": `export default "not a layout, unless the router says so";`,
  "routes/(marketing)/about/page.ts": `export default "about";`,
  "routes/(marketing)/docs/[...rest]/page.ts": `export default "docs";`,
  "routes/q&a/page.ts": `export default "q&a";`,
  "routes/mjs/page.mjs": `export default "mjs";`,
  "routes/big/[n]/page.ts": `export const big = true; export default "big";`,
  "routes/item/[id]/page.ts": `export default "item";`,
  "routes/register.js": `import "./from-bunfig.js"; globalThis.registered = "side-effect-kept"; export default 1;`,
  "routes/from-bunfig.js": `globalThis.seen = "bunfig-plugin-did-not-run";`,
  "routes/secret.ts": `export const secret = "server-only-secret";`,
  "routes/js/page.js": `
    import registered from "../register.js";
    import { secret } from "../secret.ts";
    export const serverOnly = () => secret;
    export default "js";
  `,
  "routes/client/page.tsx": `
    export const serverOnly = "server-only-export";
    export default function Page() { return <div title="BEFORE_PLUGIN" />; }
  `,
};

test.concurrent("bun bake build finds and builds the pages of a framework as bun bake does", async () => {
  using dir = tempDir("bake-build-framework", frameworkFiles);
  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const json = async (path: string) => (await fetch(new URL(path, url))).json();

  // The default of `layouts` is false.
  expect(await json("/")).toMatchObject({ params: null, layouts: 0 });
  // A route group is not in the URL, nor counted as a part of it.
  expect(await json("/about")).toMatchObject({ params: null });
  expect(await json("/docs/a/b%20c")).toMatchObject({ params: { rest: ["a", "b c"] } });
  // As browsers send it.
  expect(await json("/q&a")).toMatchObject({ params: null });
  // The default of `extensions` has `.mjs`.
  expect(await json("/mjs")).toMatchObject({ params: null });
  expect((await fetch(new URL("/docs/%zz", url))).status).toBe(404);

  // The browser code: what a plugin and the tsconfig.json make of the file, without the exports
  // that run on the server and what only they import, with what is imported for its side effect.
  const scripts = async (path: string) => {
    const [module] = (await json(path)).modules;
    return (await get(url, module)).slice("200 ".length);
  };
  const clientPage = await scripts("/client");
  expect(clientPage).toContain("after-plugin");
  expect(clientPage).toContain("projectJsx");
  expect(clientPage).not.toContain("server-only-export");
  const jsPage = await scripts("/js");
  expect(jsPage).toContain("side-effect-kept");
  expect(jsPage).toContain("bunfig-plugin-ran");
  expect(jsPage).not.toContain("server-only-secret");

  // Kept pages have a limit: the first of these is gone after the others.
  const render = async (n: number) => (await fetch(new URL(`/big/${n}`, url))).headers.get("x-render");
  const first = await render(0);
  expect(await render(0)).toBe(first);
  const renders = [];
  for (let n = 1; n <= 16; n++) renders.push(await render(n));
  expect(await render(16)).toBe(renders.at(-1));
  expect(await render(0)).not.toBe(first);
});

test.concurrent("bun bake and bun bake build give a page the same params", async () => {
  using dir = tempDir("bake-build-params", frameworkFiles);
  await using dev = spawnBake(String(dir), ["bake", "--port=0"]);
  const devUrl = await getServerUrl(dev);
  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  const paramsFrom = async (server: string, path: string) => (await (await fetch(new URL(path, server))).json()).params;
  const expected = {
    "/": null,
    "/item/caf%C3%A9": { id: "café" },
    "/docs/one": { rest: ["one"] },
    "/docs/a/b%20c": { rest: ["a", "b c"] },
  };
  for (const server of [devUrl, url]) {
    const params = Object.fromEntries(
      await Promise.all(Object.keys(expected).map(async path => [path, await paramsFrom(server, path)])),
    );
    expect(params).toEqual(expected);
  }
});

test.concurrent("bun bake build loads the client entry point of a framework without clientPages", async () => {
  using dir = tempDir("bake-build-client-entry", {
    "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
      fileSystemRouterTypes: [{
        root: "routes",
        style: "nextjs-pages",
        serverEntryPoint: "./render/server.ts",
        clientEntryPoint: "./render/client.ts",
      }],
    } }] };`,
    "render/server.ts": `export function render(request, meta) { return Response.json(meta.modules); }`,
    "render/client.ts": `console.log("from-client-entry");`,
    "routes/index.ts": `export default "server-only-page";`,
  });
  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  const [module] = await (await fetch(url)).json();
  const code = await get(url, module);
  expect(code).toContain("from-client-entry");
  expect(code).not.toContain("server-only-page");
});

// Creating a symlink on Windows needs a privilege that CI does not have.
test.concurrent.skipIf(isWindows)(
  "bun bake build removes the server-only exports of a page reached through a symlink",
  async () => {
    const router = (root: string) => `{
      root: "${root}",
      style: "nextjs-pages",
      serverEntryPoint: "./render/server.ts",
      clientEntryPoint: "./render/client.ts",
      clientPages: { serverExports: ["serverOnly"] },
    }`;
    const page = (name: string) => `
      export const serverOnly = () => "secret-of-${name}";
      export default "page-${name}";
    `;
    using dir = tempDir("bake-build-symlink-exports", {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
        fileSystemRouterTypes: [${router("linked")}, ${router("routes")}],
      } }] };`,
      "render/server.ts": `export function render(request, meta) { return Response.json(meta.modules); }`,
      "render/client.ts": `import { route } from "bun:bake/client"; await route.page();`,
      "real/in-root.ts": page("in-root"),
      "routes/plain.ts": page("plain"),
      "shared/folder/in-folder.ts": page("in-folder"),
      "shared/file.ts": page("file"),
    });
    symlinkSync(join(String(dir), "real"), join(String(dir), "linked"));
    symlinkSync(join(String(dir), "shared/folder"), join(String(dir), "routes/folder"));
    symlinkSync(join(String(dir), "shared/file.ts"), join(String(dir), "routes/file.ts"));

    const build = await buildApp(String(dir));
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const { proc, url } = await startBuild(String(dir));
    await using _ = proc;

    for (const [path, name] of [
      ["/in-root", "in-root"],
      ["/plain", "plain"],
      ["/folder/in-folder", "in-folder"],
      ["/file", "file"],
    ]) {
      const [module] = await (await fetch(new URL(path, url))).json();
      const code = await get(url, module);
      expect(code).toContain(`page-${name}`);
      expect(code).not.toContain(`secret-of-${name}`);
    }
  },
);

test.concurrent.skipIf(isWindows)("bun bake build serves .html pages reached through a symlink", async () => {
  using dir = tempDir("bake-build-symlink-html", {
    "shared/docs/index.html": `<!doctype html><title>docs</title><p>in a linked folder</p>`,
    "shared/page.html": `<!doctype html><title>page</title><p>a linked file</p>`,
    "app/pages/.keep": "",
  });
  symlinkSync(join(String(dir), "shared/docs"), join(String(dir), "app/pages/docs"));
  symlinkSync(join(String(dir), "shared/page.html"), join(String(dir), "app/pages/one.html"));
  symlinkSync(join(String(dir), "shared/page.html"), join(String(dir), "app/pages/two.html"));

  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await get(url, "/docs")).toContain("in a linked folder");
  expect(await get(url, "/one")).toContain("a linked file");
  expect(await get(url, "/two")).toContain("a linked file");
});

test.concurrent("bun bake build lets a route of app/server.ts answer for a file of public/", async () => {
  using dir = tempDir("bake-build-public-route", {
    "public/robots.txt": "from public",
    "public/other.txt": "other file",
    "app/server.ts": `export default { routes: { "/robots.txt": () => new Response("from the app") } };`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await get(url, "/robots.txt")).toBe("200 from the app");
  expect(await get(url, "/other.txt")).toBe("200 other file");
});

test.concurrent.each([
  ["an .html page", { "app/pages/about.html": `<!doctype html><title>about</title>` }],
  [
    "a page of a framework",
    {
      "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
        fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./r.ts" }],
      } }] };`,
      "r.ts": `export function render() { return new Response("page"); }`,
      "routes/about.ts": `export default 1;`,
    },
  ],
])("the server of bun bake build refuses a route of app/server.ts that is also %s", async (_, files) => {
  using dir = tempDir("bake-build-page-route", {
    ...files,
    "app/server.ts": `export default { routes: { "/about": () => new Response("from the app") } };`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  // Not `expect().rejects`: it runs the event loop inside the call, and the concurrent tests lose events.
  const error = await startBuild(String(dir)).catch(error => error);
  expect(error.message).toContain(`The route "/about" of app/server.ts is also a page.`);
});

test.concurrent("bun bake build serves a page at a fixed path before an optional catch-all", async () => {
  using dir = tempDir("bake-build-optional-catch-all", {
    "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
      fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./r.ts" }],
    } }] };`,
    "r.ts": `export function render(request, meta) {
      return Response.json({ page: meta.pageModule.default, params: meta.params });
    }`,
    "routes/index.ts": `export default "index";`,
    "routes/[[...slug]].ts": `export default "catch-all";`,
    "routes/docs/[[...rest]].ts": `export default "docs";`,
  });
  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const json = async (path: string) => (await fetch(new URL(path, url))).json();

  expect(await json("/")).toEqual({ page: "index", params: null });
  expect(await json("/a/b")).toEqual({ page: "catch-all", params: { slug: ["a", "b"] } });
  // With nothing at its fixed path, an optional catch-all still answers there.
  expect(await json("/docs")).toEqual({ page: "docs", params: null });
});

test.concurrent("bun bake build refuses a framework with server components", async () => {
  using dir = tempDir("bake-build-server-components", {
    "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
      serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: "./rsc.ts" },
      fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./r.ts" }],
    } }] };`,
    "rsc.ts": `export function registerClientReference() {}`,
    "r.ts": `export function render() { return new Response("page"); }`,
    "routes/index.ts": `export default 1;`,
  });
  const { stdout, stderr, exitCode } = await buildApp(String(dir));
  expect(stderr).toContain(`"bun bake build" does not support the serverComponents option of a framework.`);
  expect(existsSync(join(String(dir), "dist"))).toBe(false);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.concurrent("bun bake build reports a folder with nothing to serve", async () => {
  using dir = tempDir("bake-build-nothing", { "readme.txt": "not an app" });
  const { stdout, stderr, exitCode } = await buildApp(String(dir));
  expect(stderr).toContain("Nothing to serve in");
  expect(existsSync(join(String(dir), "dist"))).toBe(false);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.concurrent("bun bake build runs app/server.ts with the project as the working directory", async () => {
  using dir = tempDir("bake-build-tls", {
    "certs/key.pem": tlsCert.key,
    "certs/cert.pem": tlsCert.cert,
    "app/server.ts": `export default {
      tls: { key: Bun.file("./certs/key.pem"), cert: Bun.file("./certs/cert.pem") },
      routes: { "/api": () => new Response("api") },
    };`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const res = await fetch(new URL("/api", url), { tls: { rejectUnauthorized: false } });
  expect(await res.text()).toBe("api");
});

test.concurrent("bun bake build reports two pages with the same URL pattern", async () => {
  using dir = tempDir("bake-build-collision", {
    "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
      fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./r.ts" }],
    } }] };`,
    "r.ts": `export function render() { return new Response("x"); }`,
    "routes/[a].ts": `export default 1;`,
    "routes/[b].ts": `export default 2;`,
  });
  const { stdout, stderr, exitCode } = await buildApp(String(dir));
  expect(stderr).toStartWith("error: Invalid route");
  expect(stderr).toContain("Multiple pages matching the same route pattern is ambiguous");
  expect(stderr).toContain("[a].ts");
  expect(stderr).toContain("[b].ts");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.concurrent("bun bake build refuses a page that no URL can reach", async () => {
  using dir = tempDir("bake-build-bad-name", {
    "bake.config.ts": `export default { plugins: [{ name: "a", framework: {
      fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./r.ts" }],
    } }] };`,
    "r.ts": `export function render() { return new Response("x"); }`,
    "routes/100%.ts": `export default 1;`,
  });
  const { stderr, exitCode } = await buildApp(String(dir));
  expect(stderr).toContain(`a page cannot have ":", "*", "?", "#" or "%" in its path`);
  expect(exitCode).toBe(1);
});

test.concurrent.each([[["--check", "bake", "build"]], [["bake", "build", "--check"]]])(
  "bun bake build refuses --check in %j",
  async args => {
    using dir = tempDir("bake-build-check", { "app/pages/index.html": page });
    await using build = spawnBake(String(dir), args);
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(stderr).toContain(`"bun bake build" builds once. Remove --check, --watch and --hot.`);
    expect(exitCode).toBe(1);
  },
);

test.concurrent("bun bake build keeps the project's own server.js apart from dist/server.js", async () => {
  using dir = tempDir("bake-build-root-server", {
    "server.js": `export const answer = "from the project's server.js";`,
    "app/server.ts": `
      import { answer } from "../server.js";
      export default { routes: { "/answer": () => new Response(answer) } };
    `,
  });
  const build = await buildApp(String(dir));
  expect(build.stderr).toBe("");
  expect(build.exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await get(url, "/answer")).toBe("200 from the project's server.js");
  expect(readFileSync(join(String(dir), "server.js"), "utf8")).toBe(
    `export const answer = "from the project's server.js";`,
  );
});

// Bun.serve's `unix` option takes a socket path, which this test only makes on POSIX.
test.concurrent.skipIf(isWindows)("the server of bun bake build keeps a unix socket when HOST is set", async () => {
  using dir = tempDir("bake-build-unix", {});
  const socket = join(String(dir), "app.sock");
  await Bun.write(
    join(String(dir), "app/server.ts"),
    `export default { unix: ${JSON.stringify(socket)}, fetch: () => new Response("via unix") };`,
  );
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc } = await startBuild(String(dir), "dist/server.js", { HOST: "127.0.0.1" }, /Listening on (unix:\S+)/);
  await using _ = proc;

  expect(await (await fetch("http://localhost/", { unix: socket })).text()).toBe("via unix");
});

test.concurrent("bun bake build gives pages and .html scripts the values of import.meta.env", async () => {
  const values = `[import.meta.env.DEV, import.meta.env.PROD, import.meta.env.MODE, import.meta.env.SSR, import.meta.env.STATIC]`;
  using dir = tempDir("bake-build-import-meta-env", {
    "app/pages/index.html": `<!doctype html><html><body><script type="module" src="./page.ts"></script></body></html>`,
    "app/pages/page.ts": `globalThis.seen = "env-in-browser:" + JSON.stringify(${values});`,
    "app/server.ts": `export default { routes: { "/env": () => Response.json(${values}) } };`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await (await fetch(new URL("/env", url))).json()).toEqual([false, true, "production", true, false]);
  const [, script] = (await get(url, "/")).match(/<script type="module"[^>]* src="([^"]+)"/)!;
  const code = await get(url, script);
  expect(code).not.toContain("import.meta");
  expect(code).toContain(`[!1,!0,"production",!1,!1]`);
});

test.concurrent("bun bake build refuses an app/server.ts with no default export", async () => {
  using dir = tempDir("bake-build-no-default", {
    "app/server.ts": `export const routes = { "/": () => new Response("hi") };`,
  });
  const { stdout, stderr, exitCode } = await buildApp(String(dir));
  expect(stderr).toContain(`No matching export in "app/server.ts" for import "default"`);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test.concurrent(
  "the server of bun bake build refuses a default export of app/server.ts that is no object",
  async () => {
    using dir = tempDir("bake-build-function-default", {
      "app/server.ts": `export default function () {}`,
    });
    expect((await buildApp(String(dir))).exitCode).toBe(0);
    const error = await startBuild(String(dir)).catch(error => error);
    expect(error.message).toContain(
      `"app/server.ts" must have a default export with "routes", "fetch" or "websocket".`,
    );
  },
);

const htmlFiles = {
  "app/pages/index.html": `<!doctype html><html><body><h1>home html</h1><script type="module" src="./home.ts"></script></body></html>`,
  "app/pages/home.ts": `console.log("home script", process.env.PUBLIC_NAME);`,
  "app/pages/docs/index.html": `<!doctype html><html><body><h1>docs html</h1></body></html>`,
  "app/server.ts": `export default { routes: { "/api/name": () => new Response(process.env.PUBLIC_NAME) } };`,
  "bunfig.toml": `[serve.static]\nenv = "PUBLIC_*"\n`,
  ".env": `PUBLIC_NAME=from-env\n`,
};

test.concurrent.each([{}, { BUN_ENV: "development" }])(
  "bun bake build gives the browser the values of .env.production, not .env.development, with %j",
  async extraEnv => {
    using dir = tempDir("bake-build-env-files", {
      ...htmlFiles,
      ".env.development": `PUBLIC_NAME=from-development\n`,
      ".env.production": `PUBLIC_NAME=from-production\n`,
    });
    expect((await buildApp(String(dir), [], extraEnv)).exitCode).toBe(0);
    const { proc, url } = await startBuild(String(dir));
    await using _ = proc;

    const [, script] = (await get(url, "/")).match(/<script type="module"[^>]* src="([^"]+)"/)!;
    const code = await get(url, script);
    expect(code).toContain("from-production");
    expect(code).not.toContain("from-development");
  },
);

test.concurrent("bun bake build gives pages and .html scripts the define of [serve.static]", async () => {
  using dir = tempDir("bake-build-define", {
    "bunfig.toml": `[serve.static]\ndefine = { "DEFINED_NAME" = '"from-bunfig"' }\n`,
    "app/pages/index.html": `<!doctype html><html><body><script type="module" src="./page.ts"></script></body></html>`,
    "app/pages/page.ts": `globalThis.seen = DEFINED_NAME;`,
    "app/server.ts": `export default { routes: { "/define": () => new Response(DEFINED_NAME) } };`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await get(url, "/define")).toBe("200 from-bunfig");
  const [, script] = (await get(url, "/")).match(/<script type="module"[^>]* src="([^"]+)"/)!;
  expect(await get(url, script)).toContain("from-bunfig");
});

test.concurrent("bun bake build does not keep a response with Vary or Set-Cookie", async () => {
  using dir = tempDir("bake-build-vary", {
    "render/server.ts": `
      let renders = 0;
      export function render(request, meta) {
        const headers = { "cache-control": "s-maxage=1000", ...meta.pageModule.headers };
        return new Response("render " + ++renders + " " + request.headers.get("accept-language"), { headers });
      }
    `,
    "bake.config.ts": `export default { plugins: [{ name: "strings", framework: { fileSystemRouterTypes: [{ root: "app/pages", style: "nextjs-pages", serverEntryPoint: "./render/server.ts" }] } }] };`,
    "app/pages/kept.ts": `export const headers = {}; export default "kept";`,
    "app/pages/vary.ts": `export const headers = { vary: "Accept-Language" }; export default "vary";`,
    "app/pages/cookie.ts": `export const headers = { "set-cookie": "session=first" }; export default "cookie";`,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;
  const language = async (path: string, language: string) => {
    const res = await fetch(new URL(path, url), { headers: { "accept-language": language } });
    return (await res.text()).split(" ").slice(2).join(" ");
  };

  expect([await language("/kept", "en"), await language("/kept", "fr")]).toEqual(["en", "en"]);
  expect([await language("/vary", "en"), await language("/vary", "fr")]).toEqual(["en", "fr"]);
  expect([await language("/cookie", "en"), await language("/cookie", "fr")]).toEqual(["en", "fr"]);
});

test.concurrent("the server of bun bake build reads the options of app/server.ts from its prototype", async () => {
  using dir = tempDir("bake-build-class-export", {
    "app/server.ts": `
      class App {
        get routes() { return { "/route": new Response("from a route") }; }
        fetch() { return new Response("from fetch"); }
      }
      export default new App();
    `,
  });
  expect((await buildApp(String(dir))).exitCode).toBe(0);
  const { proc, url } = await startBuild(String(dir));
  await using _ = proc;

  expect(await get(url, "/route")).toBe("200 from a route");
  expect(await get(url, "/other")).toBe("200 from fetch");
});

test.concurrent("bun bake build works after bake.config.ts removes the globals that it uses", async () => {
  using dir = tempDir("bake-build-globals", {
    "bake.config.ts": `
      delete RegExp.escape;
      delete Map.groupBy;
      delete Array.prototype.toReversed;
      export default {};
    `,
    "app/pages/index.html": `<!doctype html><html><body><h1>home</h1></body></html>`,
  });
  const { stdout, stderr, exitCode } = await buildApp(String(dir));
  expect(stdout + stderr).toContain("Built 1 page");
  expect(exitCode).toBe(0);
});

test.concurrent("bun bake build serves .html pages of the same file name, from any folder", async () => {
  using dir = tempDir("bake-build-html", htmlFiles);
  expect((await buildApp(String(dir))).exitCode).toBe(0);

  for (const [cwd, server] of [
    [String(dir), "dist/server.js"],
    [join(String(dir), "dist"), "server.js"],
  ]) {
    const { proc, url } = await startBuild(cwd, server, { PUBLIC_NAME: "from-the-server" });
    await using _ = proc;

    const home = await get(url, "/");
    expect(home).toContain("<h1>home html</h1>");
    expect(await get(url, "/docs")).toContain("<h1>docs html</h1>");
    const [, script] = home.match(/<script type="module"[^>]* src="([^"]+)"/)!;
    const code = await get(url, script);
    expect(code).toContain("home script");
    // `[serve.static] env` is for the browser code. The server reads its own environment.
    expect(code).toContain("from-env");
    expect(await get(url, "/api/name")).toBe("200 from-the-server");
  }
});
