import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync, symlinkSync } from "node:fs";
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

  expect(await get(url, "/missing")).toBe("200 1");
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
