import type { Server, Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

function replaceHash(html: string) {
  return html
    .trim()
    .split("\n")
    .map(a => a.trim())
    .filter(a => a.length > 0)
    .join("\n")
    .trim()
    .replace(/chunk-[a-z0-9]+\.css/g, "chunk-HASH.css")
    .replace(/chunk-[a-z0-9]+\.js/g, "chunk-HASH.js");
}

function extractHash(html: string, file_kind: "css" | "js") {
  const re = file_kind === "css" ? /chunk-([a-z0-9]+)\.css/ : /chunk-([a-z0-9]+)\.js/;
  return html.match(re)?.[1];
}

test("serve html", async () => {
  await using dir = tempDir("html-css-js", {
    "dashboard.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="script.js"></script>
          <script type="module" src="dashboard.js"></script>
        </head>
        <body>
          <div class="container">
            <h1>Dashboard</h1>
            <p>This is a separate route to test multiple pages work</p>
            <button id="counter">Click me: 0</button>
            <br><br>
            <a href="/">Back to Home</a>
          </div>
        </body>
      </html>
    `,
    "dashboard.js": /*js*/ `
      import './script.js';
      // Additional dashboard-specific code could go here
      console.log("How...dashing?")
    `,
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bun HTML Import Test</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="script.js"></script>
        </head>
        <body>
          <div class="container">
            <h1>Hello from Bun!</h1>
            <button id="counter">Click me: 0</button>
          </div>
        </body>
      </html>
    `,
    "script.js": /*js*/ `
      let count = 0;
      const button = document.getElementById('counter');
      button.addEventListener('click', () => {
        count++;
        button.textContent = \`Click me: \${count}\`;
      });
    `,
    "styles.css": /*css*/ `
      .container {
        max-width: 800px;
        margin: 2rem auto;
        text-align: center;
        font-family: system-ui, sans-serif;
      }

      button {
        padding: 0.5rem 1rem;
        font-size: 1.25rem;
        border-radius: 0.25rem;
        border: 2px solid #000;
        background: #fff;
        cursor: pointer;
        transition: all 0.2s;
      }

      button:hover {
        background: #000;
        color: #fff;
      }
    `,
  });

  const {
    subprocess: subprocess1,
    port,
    hostname,
  } = await waitForServer(dir, {
    "/": join(dir, "index.html"),
    "/dashboard": join(dir, "dashboard.html"),
  });
  await using subprocess = subprocess1;

  {
    const html = await (await fetch(`http://${hostname}:${port}/`)).text();
    const trimmed = html
      .trim()
      .split("\n")
      .map(a => a.trim())
      .filter(a => a.length > 0)
      .join("\n")
      .trim()
      .replace(/chunk-[a-z0-9]+\.css/g, "chunk-HASH.css")
      .replace(/chunk-[a-z0-9]+\.js/g, "chunk-HASH.js");

    expect(trimmed).toMatchInlineSnapshot(`
"<!DOCTYPE html>
<html>
<head>
<title>Bun HTML Import Test</title>
<link rel="stylesheet" crossorigin href="/chunk-HASH.css"><script type="module" crossorigin src="/chunk-HASH.js"></script></head>
<body>
<div class="container">
<h1>Hello from Bun!</h1>
<button id="counter">Click me: 0</button>
</div>
</body>
</html>"
`);
  }

  {
    const html = await (await fetch(`http://${hostname}:${port}/dashboard`)).text();
    const jsSrc = new URL(
      html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!,
      "http://" + hostname + ":" + port,
    );
    var cssSrc = new URL(
      html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/)?.[1]!,
      "http://" + hostname + ":" + port,
    );
    const trimmed = html
      .trim()
      .split("\n")
      .map(a => a.trim())
      .filter(a => a.length > 0)
      .join("\n")
      .trim()
      .replace(/chunk-[a-z0-9]+\.css/g, "chunk-HASH.css")
      .replace(/chunk-[a-z0-9]+\.js/g, "chunk-HASH.js");

    expect(trimmed).toMatchInlineSnapshot(`
"<!DOCTYPE html>
<html>
<head>
<title>Dashboard</title>
<link rel="stylesheet" crossorigin href="/chunk-HASH.css"><script type="module" crossorigin src="/chunk-HASH.js"></script></head>
<body>
<div class="container">
<h1>Dashboard</h1>
<p>This is a separate route to test multiple pages work</p>
<button id="counter">Click me: 0</button>
<br><br>
<a href="/">Back to Home</a>
</div>
</body>
</html>"
`);
    const response = await fetch(jsSrc!);
    const js = await response.text();
    expect(
      js
        .replace(/# debugId=[a-z0-9A-Z]+/g, "# debugId=<debug-id>")
        .replace(/# sourceMappingURL=[^"]+/g, "# sourceMappingURL=<source-mapping-url>"),
    ).toMatchInlineSnapshot(`
"// script.js
var count = 0;
var button = document.getElementById("counter");
button.addEventListener("click", () => {
  count++;
  button.textContent = \`Click me: \${count}\`;
});

// dashboard.js
console.log("How...dashing?");

//# debugId=<debug-id>
//# sourceMappingURL=<source-mapping-url>"
`);
    const sourceMapURL = js.match(/# sourceMappingURL=([^"]+)/)?.[1];
    if (!sourceMapURL) {
      throw new Error("No source map URL found");
    }
    const sourceMap = await (await fetch(new URL(sourceMapURL, "http://" + hostname + ":" + port))).json();
    sourceMap.sourcesContent = sourceMap.sourcesContent.map(a => a.trim());
    expect(sourceMap.debugId).toMatch(/^[0-9A-F]{32}$/);
    sourceMap.debugId = "<debug-id>";
    expect(JSON.stringify(sourceMap, null, 2)).toMatchInlineSnapshot(`
      "{
        "version": 3,
        "sources": [
          "script.js",
          "dashboard.js"
        ],
        "sourcesContent": [
          "let count = 0;\\n      const button = document.getElementById('counter');\\n      button.addEventListener('click', () => {\\n        count++;\\n        button.textContent = \`Click me: \${count}\`;\\n      });",
          "import './script.js';\\n      // Additional dashboard-specific code could go here\\n      console.log(\\"How...dashing?\\")"
        ],
        "mappings": ";AACM,IAAI,QAAQ;AACZ,IAAM,SAAS,SAAS,eAAe,SAAS;AAChD,OAAO,iBAAiB,SAAS,MAAM;AAAA,EACrC;AAAA,EACA,OAAO,cAAc,aAAa;AAAA,CACnC;;;ACHD,QAAQ,IAAI,gBAAgB;",
        "debugId": "<debug-id>",
        "names": []
      }"
    `);
    const headers = response.headers.toJSON();
    headers.date = "<date>";
    headers.sourcemap = headers.sourcemap.replace(/chunk-[a-z0-9]+\.js.map/g, "chunk-HASH.js.map");
    expect(headers).toMatchInlineSnapshot(`
{
  "content-length": "316",
  "content-type": "text/javascript;charset=utf-8",
  "date": "<date>",
  "etag": ""f862dbeedf9b72bc"",
  "sourcemap": "/chunk-HASH.js.map",
}
`);
  }

  {
    const css = await (await fetch(cssSrc!)).text();
    /* the order of the properties may change because we made add more handlers to DeclarationHandler which changes the order in which they are flushed, but semantically it should be the same */
    expect(css).toMatchInlineSnapshot(`
"/* styles.css */
.container {
  text-align: center;
  max-width: 800px;
  margin: 2rem auto;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif;
}

button {
  cursor: pointer;
  background: #fff;
  border: 2px solid #000;
  border-radius: .25rem;
  padding: .5rem 1rem;
  transition: all .2s;
  font-size: 1.25rem;
}

button:hover {
  color: #fff;
  background: #000;
}
"
`);
  }

  expect(await (await fetch(`http://${hostname}:${port}/a-different-url`)).text()).toMatchInlineSnapshot(
    `"Hello World"`,
  );

  subprocess.kill();
});

describe("serve plugins", () => {
  /**
   * Test with basic plugin which appends " OOGA BOOGA" to text file.
   */
  test("basic plugin", async () => {
    const dir = await tempDirWithFiles("bun-serve-html-txt", {
      "bunfig.toml": /* toml */ `
[serve.static]
plugins = ["./plugin.ts"]
`,
      "index.html": /* html */ `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="text-file-content"></div>
</body>
</html>
`,
      "styles.css": /* css */ `
.text-file-content {
  content: url("./example.txt");
  display: block;
  white-space: pre;
  font-family: monospace;
}
`,
      "example.txt": "LMAO",
      "plugin.ts": /* ts */ `
import type { BunPlugin } from "bun";

const p: BunPlugin = {
  name: "my-plugin",
  setup(build) {
    build.onLoad({ filter: /\\.txt$/ }, async ({ path }) => {
      const text = await Bun.file(path).text();
      return {
        loader: "text",
        contents: text + " OOGA BOOGA",
      };
    });
  },
};

export default p;
`,
    });

    const {
      subprocess: subprocess1,
      port,
      hostname,
    } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using subprocess = subprocess1;
    const response = await fetch(`http://${hostname}:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html;charset=utf-8");

    const rawHtml = await response.text();
    const html = replaceHash(rawHtml);
    expect(html).toMatchInlineSnapshot(`
"<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" crossorigin href="/chunk-HASH.css"><script type="module" crossorigin src="/chunk-HASH.js"></script></head>
<body>
<div class="text-file-content"></div>
</body>
</html>"
`);

    const hash = extractHash(rawHtml, "css");
    console.log("HASH", hash);
    const cssResponse = await fetch(`http://${hostname}:${port}/chunk-${hash}.css`);
    expect(cssResponse.status).toBe(200);
    const css = await cssResponse.text();
    // the base64 encoding of "LMAO OOGA BOOGA"
    expect(css).toMatchInlineSnapshot(`
"/* styles.css */
.text-file-content {
  content: url("data:text/plain;base64,TE1BTyBPT0dBIEJPT0dB");
  display: block;
  white-space: pre;
  font-family: monospace;
}
"
`);
  });

  test("serve html with failing plugin", async () => {
    await using dir = tempDir("html-css-js-failing-plugin", {
      "bunfig.toml": /* toml */ `
[serve.static]
plugins = ["./plugin.ts"]
`,
      "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bun HTML Import Test</title>
          <link rel="stylesheet" href="styles.css">
        </head>
        <body>
          <div class="container">
            <h1>Hello from Bun!</h1>
            <button id="counter">Click me: 0</button>
          </div>
        </body>
      </html>
    `,
      "styles.css": /*css*/ `
      .container {
        max-width: 800px;
        margin: 2rem auto;
        text-align: center;
      }
    `,
      "plugin.ts": /*ts*/ `
const p = {
  name: "failing-plugin",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async () => {
      throw new Error("Plugin failed intentionally");
    });
  },
};

export default p;
`,
    });

    const {
      subprocess: subprocess1,
      port,
      hostname,
    } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using subprocess = subprocess1;
    const response = await fetch(`http://${hostname}:${port}/`);
    expect(response.status).toBe(500);

    // try again
    const response2 = await fetch(`http://${hostname}:${port}/`);
    expect(response2.status).toBe(500);
  });

  test("empty plugin array", async () => {
    await using dir = tempDir("html-css-js-empty-plugins", {
      "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Empty Plugins Test</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="script.js"></script>
        </head>
        <body>
          <div class="container">
            <h1>Hello from Bun!</h1>
            <button id="counter">Click me: 0</button>
          </div>
        </body>
      </html>
    `,
      "styles.css": /*css*/ `
      .container {
        max-width: 800px;
        margin: 2rem auto;
        text-align: center;
      }
    `,
      "script.js": /*js*/ `
      const button = document.getElementById('counter');
      let count = 0;
      button.onclick = () => {
        count++;
        button.textContent = \`Click me: \${count}\`;
      };
    `,
      "bunfig.toml": `
[serve.static]
plugins = []`,
    });

    const {
      subprocess: subprocess1,
      port,
      hostname,
    } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
    await using subprocess = subprocess1;
    const response = await fetch(`http://${hostname}:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("<title>Empty Plugins Test</title>");
  });

  test("concurrent requests to multiple routes during plugin load", async () => {
    // Helper function to generate HTML files
    const createHtmlFile = (title: string, jsFile: string) => /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <script type="module" src="${jsFile}"></script>
        </head>
        <body>
          <h1>${title}</h1>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <a href="/products">Products</a>
            <a href="/services">Services</a>
            <a href="/blog">Blog</a>
            <a href="/team">Team</a>
            <a href="/careers">Careers</a>
            <a href="/faq">FAQ</a>
          </nav>
        </body>
      </html>
    `;

    await using dir = tempDir("html-css-js-concurrent-plugins", {
      "index.html": createHtmlFile("Home Page", "index.js"),
      "about.html": createHtmlFile("About Page", "about.js"),
      "contact.html": createHtmlFile("Contact Page", "contact.js"),
      "products.html": createHtmlFile("Products Page", "products.js"),
      "services.html": createHtmlFile("Services Page", "services.js"),
      "blog.html": createHtmlFile("Blog Page", "blog.js"),
      "team.html": createHtmlFile("Team Page", "team.js"),
      "careers.html": createHtmlFile("Careers Page", "careers.js"),
      "faq.html": createHtmlFile("FAQ Page", "faq.js"),
      "ooga.html": createHtmlFile("Ooga Page", "ooga.js"),
      "index.js": "console.log('home page')",
      "about.js": "console.log('about page')",
      "contact.js": "console.log('contact page')",
      "products.js": "console.log('products page')",
      "services.js": "console.log('services page')",
      "blog.js": "console.log('blog page')",
      "team.js": "console.log('team page')",
      "careers.js": "console.log('careers page')",
      "faq.js": "console.log('faq page')",
      "ooga.js": "console.log('ooga page')",
      "bunfig.toml": `[serve.static]
plugins = ["./plugin.js"]`,
      "plugin.js": `
export default {
  name: "test-plugin",
  setup(build) {
    // Add a small delay to simulate plugin initialization
    console.log("plugin setup");
    return new Promise(resolve => setTimeout(resolve, 1000));
  }
}`,
    });

    console.log("Waiting for server");
    const {
      subprocess: subprocess1,
      port,
      hostname,
    } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
      "/about": join(dir, "about.html"),
      "/contact": join(dir, "contact.html"),
      "/products": join(dir, "products.html"),
      "/services": join(dir, "services.html"),
      "/blog": join(dir, "blog.html"),
      "/team": join(dir, "team.html"),
      "/careers": join(dir, "careers.html"),
      "/faq": join(dir, "faq.html"),
      "/ooga": join(dir, "ooga.html"),
    });
    console.log("done waiting for server");
    await using subprocess = subprocess1;
    // Make concurrent requests to all routes while plugins are loading
    const responses = await Promise.all([
      fetch(`http://${hostname}:${port}/`),
      fetch(`http://${hostname}:${port}/about`),
      fetch(`http://${hostname}:${port}/contact`),
      fetch(`http://${hostname}:${port}/products`),
      fetch(`http://${hostname}:${port}/services`),
      fetch(`http://${hostname}:${port}/blog`),
      fetch(`http://${hostname}:${port}/team`),
      fetch(`http://${hostname}:${port}/careers`),
      fetch(`http://${hostname}:${port}/faq`),
    ]);

    // All requests should succeed
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    // Verify content of all pages
    const texts = await Promise.all(responses.map(r => r.text()));
    const pages = ["Home", "About", "Contact", "Products", "Services", "Blog", "Team", "Careers", "FAQ"];
    texts.forEach((text, i) => {
      expect(text).toContain(`<title>${pages[i]} Page</title>`);
    });

    // Make another request and verify it's fast (plugins already loaded)
    const startTime = performance.now();
    const secondHomeResponse = await fetch(`http://${hostname}:${port}/ooga`);
    const duration = performance.now() - startTime;

    expect(secondHomeResponse.status).toBe(200);
    expect(duration).toBeLessThan(500); // Should be much faster than initial plugin load

    subprocess.kill();
  });
});

async function waitForServer(
  dir: string,
  entryPoints: Record<string, string>,
): Promise<{
  subprocess: Subprocess;
  port: number;
  hostname: string;
}> {
  console.log("waitForServer", dir, entryPoints);
  let defer = Promise.withResolvers<{
    subprocess: Subprocess;
    port: number;
    hostname: string;
  }>();
  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "bun-serve-static-fixture.js")],
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

test("serve html error handling", async () => {
  await using dir = tempDir("bun-serve-html-error-handling", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Error Page</title>
        </head>
        <body>
          <h1>Error Page</h1>
          <script type="module" src="error.js"></script>
        </body>
      </html>
    `,
    "error.js": /*js*/ `
      throw new Error("Error on purpose");
    `,
  });
  async function getServers() {
    const path = join(dir, "index.html");

    const { default: html } = await import(path);
    let servers: Server[] = [];
    for (let i = 0; i < 10; i++) {
      servers.push(
        Bun.serve({
          port: 0,
          static: {
            "/": html,
          },
          development: true,
          fetch(req) {
            return new Response("Not found", { status: 404 });
          },
        }),
      );
    }

    delete require.cache[path];

    return servers;
  }

  {
    let servers = await getServers();
    Bun.gc();
    await Bun.sleep(1);
    for (const server of servers) {
      await server.stop(true);
    }
    servers = [];
    Bun.gc();
  }

  Bun.gc(true);
});

// The dev server treats a file that fails to load with ENOENT as deleted and
// leaves it to the importers to report. The html file of a route has no
// importer, so the route used to reach the loaded state without any bundled
// html and crash the process while it rendered the page. Now the route reports
// the missing file and watches its directory, so the page comes back with the
// file. Nothing else in the directory was ever bundled, so nothing else
// watches it.
test("serve html whose file is deleted before its first bundle", async () => {
  using dir = tempDir("bun-serve-html-deleted-route-file", {
    "index.html": `<!DOCTYPE html><html><head><title>restored page</title></head><body><script type="module" src="./app.ts"></script></body></html>`,
    "app.ts": `console.log("app");`,
    "serve.ts": /*ts*/ `
      import { renameSync } from "node:fs";
      import { join } from "node:path";
      import html from "./index.html";

      const htmlPath = join(import.meta.dir, "index.html");
      const movedPath = htmlPath + ".moved";

      const server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      async function page() {
        const response = await fetch(server.url);
        const text = await response.text();
        return { status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] };
      }

      renameSync(htmlPath, movedPath);
      // The second request hits the route while it is already marked as failed.
      const missing = [await page(), await page()];

      renameSync(movedPath, htmlPath);
      let restored = await page();
      const deadline = Date.now() + 30_000;
      while (restored.status !== 200 && Date.now() < deadline) {
        await Bun.sleep(10);
        restored = await page();
      }

      console.log(JSON.stringify({ missing, restored }));
      server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "serve.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const failed = { status: 500, title: "Bun - Build Failed" };
  expect({ stdout: stdout.trim(), exitCode }, stderr).toEqual({
    stdout: JSON.stringify({ missing: [failed, failed], restored: { status: 200, title: "restored page" } }),
    exitCode: 0,
  });
});

/** Runs the `serve.ts` of a fixture directory to completion. */
async function runServeFixture(dir: { toString(): string }, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "serve.ts"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// The runtime turns a module into an HTMLBundle when its loader is html, and
// the loader can come from an import attribute or from a bunfig [loader] entry
// as well as from the .html extension. The dev server and the production build
// picked the loader of the route's file by its extension only, so a route whose
// file is not named .html was bundled as an asset. The bundle then finished
// without an html page for the route, and the process crashed: the dev server
// while it rendered the page, the production build while it registered the
// outputs.
describe("html route whose file is not named .html", () => {
  const htmPage = (title: string) =>
    `<!DOCTYPE html><html><head><title>${title}</title></head><body><script type="module" src="./app.ts"></script></body></html>`;

  // Serves the route with the dev server and then with a production build,
  // and fetches the page and the script the page was given in each mode.
  const serveInBothModes = (importStatement: string) => /*ts*/ `
    ${importStatement}

    async function serveOnce(development) {
      using server = Bun.serve({ port: 0, development, routes: { "/": page } });
      const response = await fetch(server.url);
      const text = await response.text();
      const scriptSrc = text.match(/<script[^>]*\\ssrc="([^"]+)"/)?.[1] ?? null;
      const scriptStatus = scriptSrc === null ? null : (await fetch(new URL(scriptSrc, server.url))).status;
      return { status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] ?? null, scriptSrc, scriptStatus };
    }

    console.log(JSON.stringify({ dev: await serveOnce(true), prod: await serveOnce(false) }));
  `;

  const served = {
    status: 200,
    title: "htm page",
    // The route's own script, not the "./app.ts" of the source file.
    scriptSrc: expect.stringMatching(/^\/.+\.js$/),
    scriptStatus: 200,
  };

  test.concurrent("import attribute", async () => {
    using dir = tempDir("bun-serve-html-htm-import-attribute", {
      "index.htm": htmPage("htm page"),
      "app.ts": `console.log("app");`,
      "serve.ts": serveInBothModes(`import page from "./index.htm" with { type: "html" };`),
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir);
    expect({ result: stdout === "" ? null : JSON.parse(stdout), exitCode }, stderr).toEqual({
      result: { dev: served, prod: served },
      exitCode: 0,
    });
  });

  test.concurrent("bunfig [loader]", async () => {
    using dir = tempDir("bun-serve-html-htm-bunfig-loader", {
      "bunfig.toml": `[loader]\n".htm" = "html"\n`,
      "index.htm": htmPage("htm page"),
      "app.ts": `console.log("app");`,
      "serve.ts": serveInBothModes(`import page from "./index.htm";`),
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir);
    expect({ result: stdout === "" ? null : JSON.parse(stdout), exitCode }, stderr).toEqual({
      result: { dev: served, prod: served },
      exitCode: 0,
    });
  });

  // A changed route file is bundled again through the incremental graph, which
  // has to mark it as the html file of a route too.
  test.concurrent("dev server bundles the edited file as html again", async () => {
    using dir = tempDir("bun-serve-html-htm-edit", {
      "index.htm": htmPage("htm page"),
      "app.ts": `console.log("app");`,
      "serve.ts": /*ts*/ `
        import { writeFileSync } from "node:fs";
        import page from "./index.htm" with { type: "html" };

        using server = Bun.serve({ port: 0, development: true, routes: { "/": page } });
        async function fetchPage() {
          const response = await fetch(server.url);
          const text = await response.text();
          return { status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] ?? null };
        }

        const first = await fetchPage();
        writeFileSync("index.htm", ${JSON.stringify(htmPage("edited htm page"))});
        let edited = await fetchPage();
        const deadline = Date.now() + 30_000;
        while (edited.title !== "edited htm page" && Date.now() < deadline) {
          await Bun.sleep(10);
          edited = await fetchPage();
        }
        console.log(JSON.stringify({ first, edited }));
      `,
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir);
    expect({ stdout, exitCode }, stderr).toEqual({
      stdout: JSON.stringify({
        first: { status: 200, title: "htm page" },
        edited: { status: 200, title: "edited htm page" },
      }),
      exitCode: 0,
    });
  });

  // When a file is deleted, the files that import it are bundled again so that
  // they report the missing import. This goes through the bundler directly, not
  // through the entry point list, and has to bundle the route file as html too.
  test.concurrent("dev server reports a deleted file that the page references", async () => {
    using dir = tempDir("bun-serve-html-htm-deleted-import", {
      "index.htm": htmPage("htm page"),
      "app.ts": `console.log("app");`,
      "serve.ts": /*ts*/ `
        import { unlinkSync } from "node:fs";
        import page from "./index.htm" with { type: "html" };

        using server = Bun.serve({ port: 0, development: true, routes: { "/": page } });
        async function fetchPage() {
          const response = await fetch(server.url);
          const text = await response.text();
          return { status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] ?? null };
        }

        const first = await fetchPage();
        unlinkSync("app.ts");
        let deleted = await fetchPage();
        const deadline = Date.now() + 30_000;
        while (deleted.status === 200 && Date.now() < deadline) {
          await Bun.sleep(10);
          deleted = await fetchPage();
        }
        console.log(JSON.stringify({ first, deleted }));
      `,
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir);
    expect({ stdout, exitCode }, stderr).toEqual({
      stdout: JSON.stringify({
        first: { status: 200, title: "htm page" },
        deleted: { status: 500, title: "Bun - Build Failed" },
      }),
      exitCode: 0,
    });
  });

  // An onResolve plugin whose filter matches the route file takes the entry
  // point through the plugin path of the bundler. The file is still bundled as
  // html when the plugin declines, and when it resolves the file to itself.
  test.concurrent("onResolve plugin that declines or returns the file", async () => {
    using dir = tempDir("bun-serve-html-htm-resolve-plugin", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "index.htm": htmPage("htm page"),
      "app.ts": `console.log("app");`,
      "plugin.ts": /*ts*/ `
        export default {
          name: "resolve-htm",
          setup(build) {
            build.onResolve({ filter: /\\.htm$/ }, args => (globalThis.returnTheFile ? { path: args.path } : undefined));
          },
        };
      `,
      "serve.ts": /*ts*/ `
        import page from "./index.htm" with { type: "html" };

        async function serveOnce(development) {
          using server = Bun.serve({ port: 0, development, routes: { "/": page } });
          const response = await fetch(server.url);
          const text = await response.text();
          return { status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] ?? null };
        }

        const results = {};
        for (const returnTheFile of [false, true]) {
          globalThis.returnTheFile = returnTheFile;
          results[returnTheFile ? "returned" : "declined"] = { dev: await serveOnce(true), prod: await serveOnce(false) };
        }
        console.log(JSON.stringify(results));
      `,
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir);
    const page = { status: 200, title: "htm page" };
    expect({ stdout, exitCode }, stderr).toEqual({
      stdout: JSON.stringify({
        declined: { dev: page, prod: page },
        returned: { dev: page, prod: page },
      }),
      exitCode: 0,
    });
  });
});

// A plugin can resolve the route's html file to a different file. The bundle
// then finishes without an html page for the route's file. Both the dev server
// and the production build used to crash on that: the dev server when it
// rendered the page, or when it stored the page of the other html file, the
// production build when it registered the outputs without an html page.
//
// The dev server now reports a build failure for the route. The production
// build does too when the other file is not html. When it is, the production
// build serves that file, as it does for any entry point a plugin resolves.
describe("html route whose file a plugin resolves to a different file", () => {
  const otherPage = { status: 200, title: "other page" };
  const failurePage = { status: 500, title: "Bun - Build Failed" };
  const emptyFailure = { status: 500, title: null };
  const builtWithout: Record<string, object> = {
    "app.ts": { devWithoutHmr: [emptyFailure, emptyFailure], production: [emptyFailure] },
    "other.html": { devWithoutHmr: [otherPage, otherPage], production: [otherPage] },
  };

  // With BUN_ASSUME_PERFECT_INCREMENTAL=0, the default of release builds, the
  // dev server bundles a failed route again for the next request, and that
  // bundle has to report the failure again. With 1, the default of debug
  // builds, the next request is answered from the recorded failure.
  test.concurrent.each([
    ["app.ts", "0"],
    ["app.ts", "1"],
    ["other.html", "0"],
    ["other.html", "1"],
  ])("resolved to %s, BUN_ASSUME_PERFECT_INCREMENTAL=%s", async (target, assumePerfectIncremental) => {
    using dir = tempDir("bun-serve-html-route-resolved-elsewhere", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "index.html": `<!DOCTYPE html><html><head><title>never served</title></head><body></body></html>`,
      "other.html": `<!DOCTYPE html><html><head><title>other page</title></head><body></body></html>`,
      "app.ts": `console.log("app");`,
      "plugin.ts": /*ts*/ `
        import { join } from "node:path";
        export default {
          name: "resolve-html-elsewhere",
          setup(build) {
            build.onResolve({ filter: /index\\.html$/ }, () => ({ path: join(import.meta.dir, ${JSON.stringify(target)}) }));
          },
        };
      `,
      "serve.ts": /*ts*/ `
        import page from "./index.html";

        async function serve(development, requestCount) {
          using server = Bun.serve({ port: 0, development, routes: { "/": page } });
          const responses = [];
          for (let i = 0; i < requestCount; i++) {
            const response = await fetch(server.url);
            const text = await response.text();
            responses.push({ status: response.status, title: text.match(/<title>(.*?)<\\/title>/)?.[1] ?? null });
          }
          return responses;
        }

        console.log(
          JSON.stringify({
            // The second request reaches the route after its bundle has failed.
            devServer: await serve(true, 2),
            // Every request builds the route again.
            devWithoutHmr: await serve({ hmr: false }, 2),
            // Requests after a failed build are the subject of #37916.
            production: await serve(false, 1),
          }),
        );
      `,
    });
    const { stdout, stderr, exitCode } = await runServeFixture(dir, {
      BUN_ASSUME_PERFECT_INCREMENTAL: assumePerfectIncremental,
    });
    expect({ stdout, exitCode }, stderr).toEqual({
      stdout: JSON.stringify({ devServer: [failurePage, failurePage], ...builtWithout[target] }),
      exitCode: 0,
    });
    // Printed by the dev server (and by the development build when it fails too). Production says nothing.
    expect(stderr).toMatch(
      /error: Bundling "[^"]*index\.html" did not produce an html page for it\. A plugin may have resolved it to another file or loaded it as something other than html\./,
    );
  });
});

// server.reload() hands the dev server a new route object for the same html
// file. The dev server used to give it a second route bundle and deliver the
// bundled html there, so a request that was deferred on the original bundle
// while it was still building crashed the process once the bundle finished.
test.concurrent("server.reload() while an html route's first bundle is still in flight", async () => {
  using dir = tempDir("bun-serve-html-reload-during-bundle", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "index.html": `<!DOCTYPE html><html><head><title>t</title></head><body><script type="module" src="./app.ts"></script></body></html>`,
    "app.ts": `console.log("app");`,
    // Holds the first bundle open until serve.ts has reloaded the server, so
    // the request that started the bundle stays deferred on it meanwhile.
    "plugin.ts": /*ts*/ `
      export default {
        name: "hold-bundle",
        setup(build) {
          build.onLoad({ filter: /app\\.ts$/ }, async () => {
            globalThis.bundleStarted.resolve();
            await globalThis.releaseBundle.promise;
            return { loader: "ts", contents: "console.log('app');" };
          });
        },
      };
    `,
    "serve.ts": /*ts*/ `
      import html from "./index.html";

      globalThis.bundleStarted = Promise.withResolvers();
      globalThis.releaseBundle = Promise.withResolvers();

      const options = { port: 0, development: true, routes: { "/": html } };
      const server = Bun.serve(options);

      // Asks the dev server over its HMR socket which route bundle currently
      // backs "/": the client's "set url" message ('n' + route pattern) is
      // answered with 'n' + the route bundle index as a u32.
      async function routeBundleIndex() {
        const url = new URL("/_bun/hmr", server.url);
        url.protocol = "ws:";
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        const { promise, resolve, reject } = Promise.withResolvers();
        ws.onerror = reject;
        ws.onclose = () => reject(new Error("hmr socket closed before answering"));
        ws.onmessage = ({ data }) => {
          const view = new DataView(data);
          if (view.getUint8(0) === "n".charCodeAt(0)) resolve(view.getUint32(1, true));
        };
        ws.onopen = () => ws.send(new TextEncoder().encode("n/"));
        try {
          return await promise;
        } finally {
          ws.onclose = null;
          ws.close();
        }
      }

      const first = fetch(server.url).then(res => res.status);
      await globalThis.bundleStarted.promise;
      const before = await routeBundleIndex();

      server.reload(options);
      const after = await routeBundleIndex();

      globalThis.releaseBundle.resolve();
      const second = fetch(server.url).then(res => res.status);

      console.log(JSON.stringify({ first: await first, second: await second, sameRouteBundle: before === after }));
      server.stop(true);
    `,
  });
  const { stdout, stderr, exitCode } = await runServeFixture(dir);
  expect({ stdout, exitCode }, stderr).toEqual({
    stdout: JSON.stringify({ first: 200, second: 200, sameRouteBundle: true }),
    exitCode: 0,
  });
});

// process.chdir() leaves the cached top-level directory with a trailing slash,
// which the dev server then used as its root. Reporting a bundle failure
// relativizes the failing file against that root and hit a debug assertion
// (abort, exit code 134). Release builds compile the assertion out and produce
// the same relative path either way, so this only fails on a debug build.
test.concurrent("dev server started after process.chdir() reports bundle failures", async () => {
  using dir = tempDir("bun-serve-html-chdir", {
    "app/index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./app.ts"></script></body></html>`,
    "app/app.ts": `import { nope } from "./does-not-exist";\nconsole.log(nope);`,
    "serve.ts": /*ts*/ `
      import html from "./app/index.html";
      process.chdir(import.meta.dir + "/app");
      const server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      const res = await fetch(server.url);
      console.log(JSON.stringify({ status: res.status }));
      server.stop(true);
    `,
  });
  const { stdout, stderr, exitCode } = await runServeFixture(dir);
  expect(stderr).toContain(`Could not resolve: "./does-not-exist"`);
  expect(stdout, stderr).toBe(JSON.stringify({ status: 500 }));
  expect(exitCode).toBe(0);
});

test("wildcard static routes", async () => {
  await using dir = tempDir("bun-serve-html-error-handling", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>         
        </head>
        <body>
          <title>Error Page</title>
          <h1>Error Page</h1>
          <script type="module" src="error.js"></script>
        </body>
      </html>
    `,
    "error.js": /*js*/ `
      throw new Error("Error on purpose");
    `,
  });
  const { default: html } = await import(join(dir, "index.html"));
  for (let development of [true, false]) {
    using server = Bun.serve({
      port: 0,
      static: {
        "/*": html,
      },
      development,
      fetch(req) {
        return new Response("Not found", { status: 404 });
      },
    });

    for (let url of [server.url, new URL("/potato", server.url)]) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const text = await response.text();
      expect(text).toContain("<title>Error Page</title>");
    }
  }
});

test("serve html with JSX runtime in development mode", async () => {
  const dir = join(import.meta.dir, "jsx-runtime");
  const { default: html } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    development: true,
    static: {
      "/": html,
    },
    fetch(req) {
      return new Response("Not found", { status: 404 });
    },
  });

  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  const htmlText = await response.text();
  const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
  const js = await (await fetch(new URL(jsSrc, server.url))).text();

  // Development mode should use jsxDEV
  expect(js).toContain("jsx_dev_runtime.jsxDEV");
  expect(js).not.toContain("jsx_runtime.jsx");
});

test("serve html with JSX runtime in production mode", async () => {
  const dir = join(import.meta.dir, "jsx-runtime");
  const { default: html } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    development: false,
    static: {
      "/": html,
    },
    fetch(req) {
      return new Response("Not found", { status: 404 });
    },
  });

  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  const htmlText = await response.text();
  const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
  const js = await (await fetch(new URL(jsSrc, server.url))).text();
  // jsxDEV looks like this:
  //  jsxDEV("button", {
  //    children: "Click me"
  //  }, undefined, false, undefined, this)
  expect(js).toContain(`("h1",{children:"Hello from JSX"})`);
});

test("you can have HTML imports apply to only specific methods outside of the dev server", async () => {
  const dir = join(import.meta.dir, "jsx-runtime");
  const { default: html } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    development: false,
    static: {
      "/boop": html,

      "/": {
        GET: html,
        POST: html,
        async PATCH() {
          return new Response("PATCH!", { status: 200 });
        },
      },
    },
    fetch(req) {
      return new Response("Not found", { status: 404 });
    },
  });

  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  const htmlText = await response.text();
  const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
  const js = await (await fetch(new URL(jsSrc, server.url))).text();
  // jsxDEV looks like this:
  //  jsxDEV("button", {
  //    children: "Click me"
  //  }, undefined, false, undefined, this)
  expect(js).toContain(`("h1",{children:"Hello from JSX"})`);
  const response2 = await fetch(server.url, {
    method: "POST",
  });
  expect(response2.status).toBe(200);
  expect(await response2.text()).toEqual(htmlText);
  const response3 = await fetch(server.url, {
    method: "PATCH",
  });
  expect(response3.status).toBe(200);
  expect(await response3.text()).toBe("PATCH!");

  expect(await (await fetch(server.url + "/boop")).text()).toEqual(htmlText);
  expect(await (await fetch(server.url + "/boop", { method: "POST" })).text()).toEqual(htmlText);
  expect(await (await fetch(server.url + "/boop", { method: "PATCH" })).text()).toBe(htmlText);
});

for (let development of [true, false, { hmr: false }]) {
  // `{ hmr: false }` does a full React production bundle for every route
  // fetch; under the debug build that is slow enough to exceed the default
  // per-test timeout. The hmr-off path is covered by the release lanes.
  const maybeTest = isDebug && typeof development === "object" ? test.skip : test;
  maybeTest(`mixed api and html routes with non-* false routes`, async () => {
    const dir = join(import.meta.dir, "jsx-runtime");
    const { default: html } = await import(join(dir, "index.html"));

    using server = Bun.serve({
      port: 0,
      development,
      static: {
        "/*": html,
        "/api": false,
        "/api/": false,
      },
      fetch(req) {
        console.log({
          url: req.url,
        });
        if (req.url.includes("/api")) {
          return Response.json({ url: req.url, method: req.method });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const htmlroutes = [
      new URL("/", server.url),
      new URL("/potato", server.url),
      new URL("/api-potato", server.url),
      new URL("/apiii", server.url),
    ];
    for (const url of htmlroutes) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const htmlText = await response.text();
      const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
      await (await fetch(new URL(jsSrc, server.url))).text();
    }
    for (const url of [new URL("/api", server.url), new URL("/api/", server.url)]) {
      const response = await fetch(url);
      const json = await response.json();
      expect(json).toEqual({ url: url.href, method: "GET" });
    }
  });

  maybeTest(`mixed api and html routes with development: ${JSON.stringify(development)}`, async () => {
    const dir = join(import.meta.dir, "jsx-runtime");
    const { default: html } = await import(join(dir, "index.html"));

    using server = Bun.serve({
      port: 0,
      development,
      static: {
        "/*": html,
        "/api/*": false,
      },
      fetch(req) {
        if (req.url.includes("/api")) {
          return Response.json({ url: req.url, method: req.method });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const htmlroutes = [
      new URL("/", server.url),
      new URL("/potato", server.url),
      new URL("/api-potato", server.url),
      new URL("/apiii", server.url),
    ];
    const apiroutes = [
      new URL("/api/", server.url),
      new URL("/api/potato", server.url),
      new URL("/api/apiii", server.url),
    ];
    for (const url of htmlroutes) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const htmlText = await response.text();
      const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
      await (await fetch(new URL(jsSrc, server.url))).text();
    }
    for (const url of apiroutes) {
      const response = await fetch(url);
      expect(await response.json()).toEqual({ url: url.toString(), method: "GET" });
    }
  });
}

describe("production headers and import.meta.env", () => {
  async function collect(development: string) {
    const dir = tempDirWithFiles("html-prod-headers", {
      "index.html": /*html*/ `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./app.css">
<script type="module" src="./app.ts"></script></head>
<body><h1>hi</h1><img src="./logo.svg"></body></html>`,
      "app.css": /*css*/ `body { color: red; }`,
      "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`,
      "app.ts": /*js*/ `
        globalThis.result = {
          MODE: import.meta.env.MODE,
          DEV: import.meta.env.DEV,
          PROD: import.meta.env.PROD,
          SSR: import.meta.env.SSR,
        };
      `,
      "serve.ts": /*js*/ `
        import index from "./index.html";
        const server = Bun.serve({ port: 0, development: ${development}, routes: { "/": index } });
        const base = server.url.href;
        const htmlRes = await fetch(base);
        const html = await htmlRes.text();
        const htmlETag = htmlRes.headers.get("etag");
        const jsPath = html.match(/src="([^"]+\\.js)"/)[1];
        const cssPath = html.match(/href="([^"]+\\.css)"/)[1];
        const svgPath = html.match(/src="([^"]+\\.svg)"/)[1];
        const jsRes = await fetch(new URL(jsPath, base));
        const js = await jsRes.text();
        const cssRes = await fetch(new URL(cssPath, base));
        const svgRes = await fetch(new URL(svgPath, base));
        const mapRes = await fetch(new URL(jsPath + ".map", base));
        const conditional = await fetch(base, { headers: { "If-None-Match": htmlETag ?? "missing" } });
        // Evaluate the bundle as a browser module would (no import.meta.env in scope).
        let evalError = null;
        try { new Function(js.replace(/^\\/\\/# (sourceMappingURL|debugId)=.*$/gm, ""))(); }
        catch (e) { evalError = String(e); }
        console.log(JSON.stringify({
          jsContainsImportMetaEnv: js.includes("import.meta.env"),
          jsHasSourceMapURL: js.includes("sourceMappingURL"),
          jsHasDebugId: js.includes("debugId"),
          evalError,
          result: globalThis.result ?? null,
          htmlETag,
          htmlCacheControl: htmlRes.headers.get("cache-control"),
          htmlConditionalStatus: conditional.status,
          jsETag: jsRes.headers.get("etag"),
          jsCacheControl: jsRes.headers.get("cache-control"),
          cssETag: cssRes.headers.get("etag"),
          cssCacheControl: cssRes.headers.get("cache-control"),
          svgPath,
          svgETag: svgRes.headers.get("etag"),
          svgCacheControl: svgRes.headers.get("cache-control"),
          mapStatus: mapRes.status,
          mapETag: mapRes.headers.get("etag"),
          mapCacheControl: mapRes.headers.get("cache-control"),
        }));
        await server.stop(true);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve.ts"],
      env: { ...bunEnv, NODE_ENV: undefined },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      throw new Error("child failed:\n" + stdout + "\n" + stderr);
    }
    return JSON.parse(stdout) as {
      jsContainsImportMetaEnv: boolean;
      jsHasSourceMapURL: boolean;
      jsHasDebugId: boolean;
      evalError: string | null;
      result: Record<string, unknown> | null;
      htmlETag: string | null;
      htmlCacheControl: string | null;
      htmlConditionalStatus: number;
      jsETag: string | null;
      jsCacheControl: string | null;
      cssETag: string | null;
      cssCacheControl: string | null;
      svgPath: string;
      svgETag: string | null;
      svgCacheControl: string | null;
      mapStatus: number;
      mapETag: string | null;
      mapCacheControl: string | null;
    };
  }

  test("development: false inlines import.meta.env.* and sets quoted ETag/Cache-Control", async () => {
    const out = await collect("false");

    // import.meta.env.* must be folded to constants in the production bundle;
    // shipping it verbatim throws in the browser.
    expect(out.jsContainsImportMetaEnv).toBe(false);
    expect(out.evalError).toBeNull();
    expect(out.result).toEqual({ MODE: "production", DEV: false, PROD: true, SSR: false });

    // Copied-file assets must be served at a content-hashed path.
    expect(out.svgPath).toMatch(/^\/logo-[a-z0-9]+\.svg$/);

    // ETags must be RFC 9110 quoted strings, content-derived (not all zeros).
    expect(out.htmlETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.jsETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.cssETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.svgETag).toMatch(/^"[0-9a-f]{16}"$/);

    // Production must not emit sourcemap comments or serve .map files;
    // they contain the original source code.
    expect(out.jsHasSourceMapURL).toBe(false);
    expect(out.jsHasDebugId).toBe(false);
    expect(out.mapStatus).toBe(404);

    // Production: HTML revalidates via ETag; content-hashed assets cache forever.
    expect({
      html: out.htmlCacheControl,
      js: out.jsCacheControl,
      css: out.cssCacheControl,
      svg: out.svgCacheControl,
    }).toEqual({
      html: "no-cache",
      js: "public, max-age=31536000, immutable",
      css: "public, max-age=31536000, immutable",
      svg: "public, max-age=31536000, immutable",
    });

    // A conditional request with the HTML ETag returns 304.
    expect(out.htmlConditionalStatus).toBe(304);
  });

  test("development: { hmr: false } inlines import.meta.env.* and quotes ETags", async () => {
    const out = await collect("{ hmr: false }");

    expect(out.jsContainsImportMetaEnv).toBe(false);
    expect(out.evalError).toBeNull();
    expect(out.result).toEqual({ MODE: "development", DEV: true, PROD: false, SSR: false });

    expect(out.htmlETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.jsETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.jsHasSourceMapURL).toBe(true);
    expect(out.jsHasDebugId).toBe(true);
    expect(out.mapStatus).toBe(200);
    expect(out.mapETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.mapETag).not.toBe('"0000000000000000"');
    expect(out.mapETag).not.toBe(out.jsETag);

    // Dev mode should not set aggressive Cache-Control.
    expect(out.htmlCacheControl).toBeNull();
    expect(out.jsCacheControl).toBeNull();
  });

  test("distinct source maps get distinct ETags", async () => {
    const serveTs = /*js*/ `
      import index from "./index.html";
      const server = Bun.serve({ port: 0, development: false, routes: { "/": index } });
      const base = server.url.href;
      const html = await (await fetch(base)).text();
      const jsPath = html.match(/src="([^"]+\\.js)"/)[1];
      const mapRes = await fetch(new URL(jsPath + ".map", base));
      console.log(JSON.stringify({ etag: mapRes.headers.get("etag") }));
      await server.stop(true);
    `;
    const run = async (appBody: string) => {
      const dir = tempDirWithFiles("html-map-etag", {
        "index.html": `<!DOCTYPE html><html><body><script type="module" src="./app.ts"></script></body></html>`,
        "app.ts": appBody,
        "serve.ts": serveTs,
        // Production serves no sourcemaps by default; opt in to exercise map ETags.
        "bunfig.toml": `[serve.static]\nsourcemap = "linked"`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.ts"],
        env: { ...bunEnv, NODE_ENV: undefined },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(stdout + "\n" + stderr);
      return JSON.parse(stdout).etag as string;
    };

    const a = await run(`console.log("one statement");`);
    const b = await run(`console.log("first");\nconsole.log("second");\nconsole.log("third");`);
    expect(a).toMatch(/^"[0-9a-f]{16}"$/);
    expect(b).toMatch(/^"[0-9a-f]{16}"$/);
    expect(a).not.toBe(b);
  });

  test("bunfig [serve.static] sourcemap overrides the per-mode default", async () => {
    const run = async (development: string, bunfig: string) => {
      const dir = tempDirWithFiles("html-sourcemap-override", {
        "index.html": `<!DOCTYPE html><html><body><script type="module" src="./app.ts"></script></body></html>`,
        "app.ts": `console.log("hello" as string);`,
        "bunfig.toml": bunfig,
        "serve.ts": /*js*/ `
          import index from "./index.html";
          const server = Bun.serve({ port: 0, development: ${development}, routes: { "/": index } });
          const base = server.url.href;
          const html = await (await fetch(base)).text();
          const jsPath = html.match(/src="([^"]+\\.js)"/)[1];
          const js = await (await fetch(new URL(jsPath, base))).text();
          const mapRes = await fetch(new URL(jsPath + ".map", base));
          console.log(JSON.stringify({
            hasLinkedMapComment: /sourceMappingURL=\\/chunk-[a-z0-9]+\\.js\\.map/.test(js),
            hasInlineMapComment: js.includes("sourceMappingURL=data:application/json"),
            mapStatus: mapRes.status,
          }));
          await server.stop(true);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.ts"],
        env: { ...bunEnv, NODE_ENV: undefined },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(stdout + "\n" + stderr);
      return JSON.parse(stdout) as {
        hasLinkedMapComment: boolean;
        hasInlineMapComment: boolean;
        mapStatus: number;
      };
    };

    const cases: [development: string, bunfigValue: string, expected: Awaited<ReturnType<typeof run>>][] = [
      // Opt back into sourcemaps in production.
      ["false", `"linked"`, { hasLinkedMapComment: true, hasInlineMapComment: false, mapStatus: 200 }],
      ["false", `true`, { hasLinkedMapComment: true, hasInlineMapComment: false, mapStatus: 200 }],
      ["false", `"inline"`, { hasLinkedMapComment: false, hasInlineMapComment: true, mapStatus: 404 }],
      // External emits .map files without a sourceMappingURL comment.
      ["false", `"external"`, { hasLinkedMapComment: false, hasInlineMapComment: false, mapStatus: 200 }],
      // "none" matches the production default.
      ["false", `"none"`, { hasLinkedMapComment: false, hasInlineMapComment: false, mapStatus: 404 }],
      // Opt out of sourcemaps in development.
      ["{ hmr: false }", `false`, { hasLinkedMapComment: false, hasInlineMapComment: false, mapStatus: 404 }],
    ];
    const results = await Promise.all(
      cases.map(([development, value]) => run(development, `[serve.static]\nsourcemap = ${value}`)),
    );
    expect(results).toEqual(cases.map(([, , expected]) => expected));
  });
});

// https://github.com/oven-sh/bun/issues/40479
describe.concurrent("bunfig [define] applies to HTML bundles", () => {
  // Serves an HTML import, fetches its script chunk, and returns the JS text.
  async function run(development: string, bunfig: string): Promise<string> {
    using dir = tempDir("html-define", {
      "index.html": `<!DOCTYPE html><html><head><script type="module" src="./app.ts"></script></head><body></body></html>`,
      "app.ts": `console.log("MARKER", BUILD_FLAG);`,
      "bunfig.toml": bunfig,
      "serve.ts": `
        import app from "./index.html";
        const server = Bun.serve({
          port: 0,
          development: ${development},
          routes: { "/": app },
          fetch: () => new Response("fallback"),
        });
        const html = await (await fetch(server.url)).text();
        const src = html.match(/<script[^>]*src="([^"]+)"/)![1];
        const js = await (await fetch(new URL(src, server.url))).text();
        console.log(JSON.stringify({ js }));
        await server.stop(true);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(stdout + "\n" + stderr);
    return (JSON.parse(stdout) as { js: string }).js;
  }

  describe.each(["true", "false"])("development: %s", development => {
    test("[define] replaces the identifier in the chunk", async () => {
      const js = await run(development, `[define]\nBUILD_FLAG = '"from-define"'`);
      expect(js).toContain("MARKER");
      expect(js).toContain('"from-define"');
      expect(js).not.toContain("BUILD_FLAG");
    });

    test("[serve.static] define wins over [define]", async () => {
      const js = await run(
        development,
        `[define]\nBUILD_FLAG = '"from-define"'\n\n[serve.static.define]\nBUILD_FLAG = '"from-serve"'`,
      );
      expect(js).toContain("MARKER");
      expect(js).toContain('"from-serve"');
      expect(js).not.toContain('"from-define"');
      expect(js).not.toContain("BUILD_FLAG");
    });
  });
});
