import { Subprocess } from "bun";
import { describe, test, expect } from "bun:test";
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

  const { subprocess, port, hostname } = await waitForServer(dir, {
    "/": join(dir, "index.html"),
    "/dashboard": join(dir, "dashboard.html"),
  });

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
  "mappings": ";AACM,IAAI,QAAQ;AACZ,IAAM,SAAS,SAAS,eAAe,SAAS;AAChD,OAAO,iBAAiB,SAAS,MAAM;AACrC;AACA,SAAO,cAAc,aAAa;AAAA,CACnC;;;ACHD,QAAQ,IAAI,gBAAgB;",
  "debugId": "0B3DD451DC3D66B564756E2164756E21",
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
  "etag": "42b631804ef51c7e",
  "sourcemap": "/chunk-HASH.js.map",
}
`);
  }

  {
    const css = await (await fetch(cssSrc!)).text();
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
  transition: all .2s;
  background: #fff;
  border: 2px solid #000;
  border-radius: .25rem;
  padding: .5rem 1rem;
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

    const { subprocess, port, hostname } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
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

    const { subprocess, port, hostname } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
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

    const { subprocess, port, hostname } = await waitForServer(dir, {
      "/": join(dir, "index.html"),
    });
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
    const { subprocess, port, hostname } = await waitForServer(dir, {
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
  let defer = Promise.withResolvers<{
    subprocess: Subprocess;
    port: number;
    hostname: string;
  }>();
  const process = Bun.spawn({
    cmd: [bunExe(), "--experimental-html", join(import.meta.dir, "bun-serve-static-fixture.js")],
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
    },
    cwd: dir,
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
