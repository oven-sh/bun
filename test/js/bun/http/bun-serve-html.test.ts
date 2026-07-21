import type { Server, Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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
  const dir = tempDirWithFiles("html-css-js", {
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
        "debugId": "DEEF3F05D4E944CA64756E2164756E21",
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
  "etag": ""0f2405c506dd6bd3"",
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
    const dir = tempDirWithFiles("html-css-js-failing-plugin", {
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
    const dir = tempDirWithFiles("html-css-js-empty-plugins", {
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

    const dir = tempDirWithFiles("html-css-js-concurrent-plugins", {
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
  const dir = tempDirWithFiles("bun-serve-html-error-handling", {
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

test("wildcard static routes", async () => {
  const dir = tempDirWithFiles("bun-serve-html-error-handling", {
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
  test(`mixed api and html routes with non-* false routes`, async () => {
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
    // Concurrent so `development: {hmr: false}` (which rebundles per request and
    // has no DevServer cache) only builds once for the whole batch.
    await Promise.all(
      htmlroutes.map(async url => {
        const response = await fetch(url);
        expect(response.status).toBe(200);
        const htmlText = await response.text();
        const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
        await (await fetch(new URL(jsSrc, server.url))).text();
      }),
    );
    for (const url of [new URL("/api", server.url), new URL("/api/", server.url)]) {
      const response = await fetch(url);
      const json = await response.json();
      expect(json).toEqual({ url: url.href, method: "GET" });
    }
  });

  test(`mixed api and html routes with development: ${JSON.stringify(development)}`, async () => {
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
    // Concurrent so `development: {hmr: false}` (which rebundles per request and
    // has no DevServer cache) only builds once for the whole batch.
    await Promise.all(
      htmlroutes.map(async url => {
        const response = await fetch(url);
        expect(response.status).toBe(200);
        const htmlText = await response.text();
        const jsSrc = htmlText.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]!;
        await (await fetch(new URL(jsSrc, server.url))).text();
      }),
    );
    for (const url of apiroutes) {
      const response = await fetch(url);
      expect(await response.json()).toEqual({ url: url.toString(), method: "GET" });
    }
  });
}

test("development: {hmr: false} bundle log reports elapsed time in ms", async () => {
  // The `[XXms] bundle index.html` line should be within an order of magnitude
  // of the wall-clock fetch time. It previously divided by ns/s instead of
  // ns/ms, reporting e.g. `[0.03ms]` for a 30ms bundle.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import html from "./index.html";
        const server = Bun.serve({
          port: 0,
          development: { hmr: false },
          routes: { "/": html },
          fetch: () => new Response("nope", { status: 404 }),
        });
        const t0 = performance.now();
        const r = await fetch(server.url);
        await r.text();
        const elapsed = performance.now() - t0;
        console.log(JSON.stringify({ status: r.status, elapsed }));
        server.stop(true);
      `,
    ],
    cwd: join(import.meta.dir, "jsx-runtime"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = JSON.parse(stdout.trim());

  const match = stderr.match(/\[([\d.]+)(ms|s)\]\s+bundle\s+index\.html/);
  expect(match, `expected a '[XXms] bundle index.html' line in stderr, got:\n${stderr}`).not.toBeNull();
  const reportedMs = parseFloat(match![1]) * (match![2] === "s" ? 1000 : 1);

  expect({
    status: result.status,
    order:
      reportedMs >= result.elapsed / 10 && reportedMs <= result.elapsed * 10
        ? "ok"
        : `reported ${reportedMs}ms, fetch took ${result.elapsed}ms`,
  }).toEqual({ status: 200, order: "ok" });
  expect(exitCode).toBe(0);
});

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
    expect(out.mapStatus).toBe(200);
    expect(out.mapETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.mapETag).not.toBe('"0000000000000000"');
    expect(out.mapETag).not.toBe(out.jsETag);

    // Production: HTML revalidates via ETag; content-hashed assets cache forever.
    expect({
      html: out.htmlCacheControl,
      js: out.jsCacheControl,
      css: out.cssCacheControl,
      svg: out.svgCacheControl,
      map: out.mapCacheControl,
    }).toEqual({
      html: "no-cache",
      js: "public, max-age=31536000, immutable",
      css: "public, max-age=31536000, immutable",
      svg: "public, max-age=31536000, immutable",
      map: "public, max-age=31536000, immutable",
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
    expect(out.mapETag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(out.mapETag).not.toBe('"0000000000000000"');

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
});
