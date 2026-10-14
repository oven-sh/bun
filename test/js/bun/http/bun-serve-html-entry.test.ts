import type { Subprocess } from "bun";
import { htmlPagesOf } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join, relative } from "node:path";

async function getServerUrl(process: Subprocess<any, "pipe", any>) {
  // Read the port number from stdout
  const decoder = new TextDecoder();
  let serverUrl = "";
  let text = "";
  for await (const chunk of process.stdout) {
    const textChunk = decoder.decode(chunk, { stream: true });
    text += textChunk;
    console.log(textChunk);

    if (text.includes("http://")) {
      serverUrl = text.trim();
      serverUrl = serverUrl.slice(serverUrl.indexOf("http://"));

      serverUrl = serverUrl.slice(0, serverUrl.indexOf("\n"));
      if (URL.canParse(serverUrl)) {
        break;
      }

      serverUrl = serverUrl.slice(0, serverUrl.indexOf("/n"));
      serverUrl = serverUrl.slice(0, serverUrl.lastIndexOf("/"));
      serverUrl = serverUrl.trim();

      if (URL.canParse(serverUrl)) {
        break;
      }
    }
  }

  if (!serverUrl) {
    throw new Error("Could not find server URL in stdout");
  }

  return serverUrl;
}

test.concurrent("bun ./index.html", async () => {
  await using dir = tempDir("html-entry-test", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>HTML Entry Test</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="app.js"></script>
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
    "app.js": /*js*/ `
      const button = document.getElementById('counter');
      let count = 0;
      button.addEventListener('click', () => {
        count++;
        button.textContent = \`Click me: \${count}\`;
      });
    `,
  });

  // Start the server by running bun with the HTML file
  await using process = Bun.spawn({
    cmd: [bunExe(), "index.html", "--port=0"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: dir,
    stdout: "pipe",
  });

  const serverUrl = await getServerUrl(process);

  try {
    // Make a request to the server using the detected URL
    const response = await fetch(serverUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();

    // Verify the HTML content
    expect(html).toContain("<title>HTML Entry Test</title>");
    expect(html).toContain('<div class="container">');

    // The bundler should have processed the CSS and JS files and injected them
    expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/chunk-[a-z0-9]+\.css">/);
    expect(html).toMatch(/<script type="module" crossorigin src="\/chunk-[a-z0-9]+\.js">/);

    // Get and verify the bundled CSS
    const cssMatch = html.match(/href="(\/chunk-[a-z0-9]+\.css)"/);
    if (cssMatch) {
      const cssResponse = await fetch(new URL(cssMatch[1], serverUrl).href);
      expect(cssResponse.status).toBe(200);
      expect(cssResponse.headers.get("content-type")).toContain("text/css");
      const css = await cssResponse.text();
      expect(css).toContain(".container");
      expect(css).toContain("max-width:800px");
    }

    // Get and verify the bundled JS
    const jsMatch = html.match(/src="(\/chunk-[a-z0-9]+\.js)"/);
    if (jsMatch) {
      const jsResponse = await fetch(new URL(jsMatch[1], serverUrl).href);
      expect(jsResponse.status).toBe(200);
      expect(jsResponse.headers.get("content-type")).toContain("javascript");
      const js = await jsResponse.text();
      expect(js).toContain('document.getElementById("counter")');
      expect(js).toContain("Click me:");
    }
  } finally {
    // The process will be automatically cleaned up by 'await using'
  }
});

test.concurrent("bun ./index.html ./about.html", async () => {
  await using dir = tempDir("html-multiple-entries-test", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Home Page</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="home.js"></script>
        </head>
        <body>
          <div class="container">
            <h1>Welcome Home</h1>
            <a href="/about">About</a>
            <button id="counter">Click me: 0</button>
          </div>
        </body>
      </html>
    `,
    "about.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>About Page</title>
          <link rel="stylesheet" href="styles.css">
          <script type="module" src="about.js"></script>
        </head>
        <body>
          <div class="container">
            <h1>About Us</h1>
            <a href="/">Home</a>
            <p id="message">This is the about page</p>
          </div>
        </body>
      </html>
    `,
    "styles.css": /*css*/ `
      .container {
        max-width: 800px;
        margin: 2rem auto;
        text-align: center;
        font-family: system-ui, sans-serif;
      }
      a {
        display: block;
        margin: 1rem 0;
        color: blue;
      }
    `,
    "home.js": /*js*/ `
      const button = document.getElementById('counter');
      let count = 0;
      button.addEventListener('click', () => {
        count++;
        button.textContent = \`Click me: \${count}\`;
      });
    `,
    "about.js": /*js*/ `
      const message = document.getElementById('message');
      message.textContent += " - Updated via JS";
      console.log(process.env.BUN_PUBLIC_FOO);
      console.log(typeof process.env.BUN_PRIVATE_FOO !== "undefined");
    `,
    "bunfig.toml": /*toml*/ `
[serve.static]
env = "BUN_PUBLIC_*"
  `,
  });
  console.log({ dir });

  // Start the server by running bun with multiple HTML files
  await using process = Bun.spawn({
    cmd: [bunExe(), "index.html", "about.html", "--port=0"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
      BUN_PUBLIC_FOO: "bar",
      BUN_PRIVATE_FOO: "baz",
    },
    cwd: dir,
    stdout: "pipe",
  });

  const serverUrl = await getServerUrl(process);

  if (!serverUrl) {
    throw new Error("Could not find server URL in stdout");
  }

  try {
    // Test the home page

    const homeResponse = await fetch(serverUrl);
    expect(homeResponse.status).toBe(200);
    expect(homeResponse.headers.get("content-type")).toContain("text/html");

    const homeHtml = await homeResponse.text();
    expect(homeHtml).toContain("<title>Home Page</title>");
    expect(homeHtml).toContain('<a href="/about">About</a>');
    expect(homeHtml).toMatch(/<script type="module" crossorigin src="\/chunk-[a-z0-9]+\.js">/);

    // Test the about page
    const aboutResponse = await fetch(new URL("/about", serverUrl).href);
    expect(aboutResponse.status).toBe(200);
    expect(aboutResponse.headers.get("content-type")).toContain("text/html");

    const aboutHtml = await aboutResponse.text();
    expect(aboutHtml).toContain("<title>About Page</title>");
    expect(aboutHtml).toContain('<a href="/">Home</a>');
    expect(aboutHtml).toMatch(/<script type="module" crossorigin src="\/chunk-[a-z0-9]+\.js">/);

    // Verify that both pages share the same CSS bundle
    const homeMatch = homeHtml.match(/href="(\/chunk-[a-z0-9]+\.css)"/);
    const aboutMatch = aboutHtml.match(/href="(\/chunk-[a-z0-9]+\.css)"/);
    expect(homeMatch?.[1], "Both pages should share the same CSS bundle").toBe(aboutMatch?.[1]!);

    // Verify the CSS bundle
    if (homeMatch) {
      const cssResponse = await fetch(new URL(homeMatch[1], serverUrl).href);
      expect(cssResponse.status).toBe(200);
      const css = await cssResponse.text();
      expect(css).toContain(".container");
      expect(css).toContain("max-width:800px");
    }

    // Verify both JS bundles work
    const homeJsMatch = homeHtml.match(/src="(\/chunk-[a-z0-9]+\.js)"/);
    if (homeJsMatch) {
      const jsResponse = await fetch(new URL(homeJsMatch[1], serverUrl).href);
      expect(jsResponse.status).toBe(200);
      const js = await jsResponse.text();
      expect(js).toContain('document.getElementById("counter")');
    }

    const aboutJsMatch = aboutHtml.match(/src="(\/chunk-[a-z0-9]+\.js)"/);
    if (aboutJsMatch) {
      const jsResponse = await fetch(new URL(aboutJsMatch[1], serverUrl).href);
      expect(jsResponse.status).toBe(200);
      const js = await jsResponse.text();
      expect(js).not.toContain("process.env.BUN_PUBLIC_FOO");
      expect(js).toContain('console.log("bar")');
      expect(js).toContain("process.env.BUN_PRIVATE_FOO");
      expect(js).not.toContain('console.log("baz")');
      expect(js).toContain('document.getElementById("message")');
    }
  } finally {
    // The process will be automatically cleaned up by 'await using'
  }
});

test.concurrent("bun *.html", async () => {
  await using dir = tempDir("html-glob-test", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Home Page</title>
          <link rel="stylesheet" href="shared.css">
          <script type="module" src="home.js"></script>
        </head>
        <body>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>
          <div class="container">
            <h1>Welcome Home</h1>
            <button id="counter">Click me: 0</button>
          </div>
        </body>
      </html>
    `,
    "about.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>About Page</title>
          <link rel="stylesheet" href="shared.css">
          <script type="module" src="about.js"></script>
        </head>
        <body>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>
          <div class="container">
            <h1>About Us</h1>
            <p id="message">This is the about page</p>
          </div>
        </body>
      </html>
    `,
    "contact.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Contact Page</title>
          <link rel="stylesheet" href="shared.css">
          <script type="module" src="contact.js"></script>
        </head>
        <body>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>
          <div class="container">
            <h1>Contact Us</h1>
            <form id="contact-form">
              <input type="text" placeholder="Name" />
              <button type="submit">Send</button>
            </form>
          </div>
        </body>
      </html>
    `,
    "shared.css": /*css*/ `
      nav {
        padding: 1rem;
        background: #f0f0f0;
        text-align: center;
      }
      nav a {
        margin: 0 1rem;
        color: blue;
      }
      .container {
        max-width: 800px;
        margin: 2rem auto;
        text-align: center;
        font-family: system-ui, sans-serif;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 300px;
        margin: 0 auto;
      }
      input, button {
        padding: 0.5rem;
        font-size: 1rem;
      }
    `,
    "home.js": /*js*/ `
      const button = document.getElementById('counter');
      let count = 0;
      button.addEventListener('click', () => {
        count++;
        button.textContent = \`Click me: \${count}\`;
      });
    `,
    "about.js": /*js*/ `
      const message = document.getElementById('message');
      message.textContent += " - Updated via JS";
    `,
    "contact.js": /*js*/ `
      const form = document.getElementById('contact-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        alert(\`Thanks for your message, \${input.value}!\`);
        input.value = '';
      });
    `,
    // Add a non-HTML file to verify it's not picked up
    "README.md": "# Test Project\nThis file should be ignored by the glob.",
  });

  // Start the server using glob pattern
  await using process = Bun.spawn({
    cmd: [bunExe(), "*.html", "--port=0"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: dir,
    stdout: "pipe",
  });
  console.log({ cwd: dir });
  const serverUrl = await getServerUrl(process);

  try {
    // Test all three pages are served
    const pages = ["", "about", "contact"];
    const titles = ["Home Page", "About Page", "Contact Page"];

    for (const [i, route] of pages.entries()) {
      const response = await fetch(new URL(route, serverUrl).href);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();
      expect(html).toContain(`<title>${titles[i]}</title>`);
      expect(html).toMatch(/<script type="module" crossorigin src="\/chunk-[a-z0-9]+\.js">/);
      expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/chunk-[a-z0-9]+\.css">/);

      // Verify navigation is present on all pages
      expect(html).toContain('<a href="/">Home</a>');
      expect(html).toContain('<a href="/about">About</a>');
      expect(html).toContain('<a href="/contact">Contact</a>');
    }

    // Verify all pages share the same CSS bundle (deduplication)
    const responses = await Promise.all(pages.map(route => fetch(new URL(route, serverUrl).href).then(r => r.text())));

    const cssMatches = responses.map(html => html.match(/href="(\/chunk-[a-z0-9]+\.css)"/)?.[1]);
    expect(
      cssMatches.every(match => match === cssMatches[0]),
      "All pages should share the same CSS bundle",
    ).toBe(true);

    // Verify the shared CSS bundle
    const cssResponse = await fetch(new URL(cssMatches[0]!, serverUrl).href);
    expect(cssResponse.status).toBe(200);
    const css = await cssResponse.text();
    expect(css).toContain("nav{");
    expect(css).toContain(".container{");
    expect(css).toContain("form{");

    // Verify each page has its own JS functionality
    const jsMatches = responses.map(html => html.match(/src="(\/chunk-[a-z0-9]+\.js)"/)?.[1]!);

    // Home page JS
    const homeJs = await fetch(new URL(jsMatches[0]!, serverUrl).href).then(r => r.text());
    expect(homeJs).toContain('document.getElementById("counter")');
    expect(homeJs).toContain("Click me:");

    // About page JS
    const aboutJs = await fetch(new URL(jsMatches[1]!, serverUrl).href).then(r => r.text());
    expect(aboutJs).toContain('document.getElementById("message")');
    expect(aboutJs).toContain("Updated via JS");

    // Contact page JS
    const contactJs = await fetch(new URL(jsMatches[2]!, serverUrl).href).then(r => r.text());
    expect(contactJs).toContain('document.getElementById("contact-form")');
    expect(contactJs).toContain("preventDefault");
  } finally {
    // The process will be automatically cleaned up by 'await using'
  }
});

test.concurrent("bun serve svg files with correct Content-Type", async () => {
  await using dir = tempDir("svg-content-type-test", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>SVG Test</title>
        </head>
        <body>
          <img src="logo.svg" alt="Logo">
        </body>
      </html>
    `,
    "logo.svg": /*svg*/ `
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />
      </svg>
    `,
  });

  // Start the server by running bun with the HTML file
  await using process = Bun.spawn({
    cmd: [bunExe(), "index.html", "--port=0"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: dir,
    stdout: "pipe",
  });

  const serverUrl = await getServerUrl(process);

  try {
    // First get the HTML and find the SVG path
    const htmlResponse = await fetch(serverUrl);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();

    // Extract the SVG path from the img tag
    const svgMatch = html.match(/<img[^>]+src="([^"]+)"/);
    expect(svgMatch, "Should find img tag with SVG source").toBeTruthy();

    // Test the SVG file using the path from HTML
    const svgResponse = await fetch(new URL(svgMatch![1], serverUrl).href);
    expect(svgResponse.status).toBe(200);
    expect(svgResponse.headers.get("content-type")).toBe("image/svg+xml");

    const svgContent = await svgResponse.text();
    expect(svgContent).toContain("<svg");
    expect(svgContent).toContain("circle");
  } finally {
    // The process will be automatically cleaned up by 'await using'
  }
});

test.concurrent("bun serve files with correct Content-Type headers", async () => {
  await using dir = tempDir("content-type-test", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Content Type Test</title>
        </head>
        <body>
          <img src="logo.svg" alt="Logo SVG">
          <img src="photo.png" alt="Photo PNG">
          <img src="document.pdf" alt="PDF">
        </body>
      </html>
    `,
    "logo.svg": /*svg*/ `
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />
      </svg>
    `,
    // A small 1x1 black PNG
    "photo.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
      "base64",
    ),
    // A minimal valid PDF file
    "document.pdf": Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj trailer<</Root 1 0 R>>",
      "utf-8",
    ),
  });

  // Start the server by running bun with the HTML file
  await using process = Bun.spawn({
    cmd: [bunExe(), "index.html", "--port=0"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: dir,
    stdout: "pipe",
  });

  const serverUrl = await getServerUrl(process);

  try {
    // First get the HTML and find all asset paths
    const htmlResponse = await fetch(serverUrl);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();

    // Test each file type and its corresponding Content-Type header
    const files = [
      {
        pattern: /<img[^>]+src="([^"]+\.svg)"/,
        expectedType: "image/svg+xml",
        expectedContent: "<svg",
      },
      {
        pattern: /<img[^>]+src="([^"]+\.png)"/,
        expectedType: "image/png",
        expectedContent: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic number
      },
      {
        pattern: /<img[^>]+src="([^"]+\.pdf)"/,
        expectedType: "application/pdf",
        expectedContent: "%PDF-",
      },
    ];

    for (const file of files) {
      const match = html.match(file.pattern);
      expect(match, `Should find ${file.expectedType} reference in HTML`).toBeTruthy();

      const response = await fetch(new URL(match![1], serverUrl).href);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(file.expectedType);

      if (typeof file.expectedContent === "string") {
        const content = await response.text();
        expect(content).toContain(file.expectedContent);
      } else {
        const content = new Uint8Array(await response.arrayBuffer());
        expect(content.slice(0, file.expectedContent.length)).toEqual(file.expectedContent);
      }
    }
  } finally {
    // The process will be automatically cleaned up by 'await using'
  }
});

test("importing bun:main from HTML entry preload does not crash", async () => {
  await using dir = tempDir("html-entry-bun-main", {
    "index.html": /*html*/ `
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body><h1>Hello</h1></body>
      </html>
    `,
    "preload.mjs": /*js*/ `
      try {
        await import("bun:main");
      } catch {}
      // Signal that preload ran successfully without crashing
      console.log("PRELOAD_OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.mjs", "index.html", "--port=0"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk, { stream: true });
    if (text.includes("http://")) break;
  }

  expect(text).toContain("PRELOAD_OK");

  proc.kill();
  await proc.exited;
});

// https://github.com/oven-sh/bun/issues/24031
test.concurrent("subdirectory routes use forward slashes on Windows", async () => {
  await using dir = tempDir("html-subdir-routes", {
    "dist/index.html": `<!DOCTYPE html><html><head><title>Home</title></head><body>Home</body></html>`,
    "dist/components/buttons.html": `<!DOCTYPE html><html><head><title>Buttons</title></head><body>Buttons</body></html>`,
  });

  await using process = Bun.spawn({
    cmd: [
      bunExe(),
      "./dist/**/*.html",
      join(String(dir), "dist", "components", "buttons.html"),
      "--port=0",
      "--hostname=127.0.0.1",
    ],
    env: { ...bunEnv, NODE_ENV: "production", NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
  });

  const decoder = new TextDecoder();
  let text = "";
  let serverUrl = "";
  for await (const chunk of process.stdout as ReadableStream<Uint8Array>) {
    text += decoder.decode(chunk, { stream: true });
    if (!serverUrl) {
      const match = text.match(/http:\/\/\S+/);
      if (match && URL.canParse(match[0])) serverUrl = match[0];
    }
    if (serverUrl && text.includes("Routes:") && text.includes("buttons")) break;
  }

  expect(serverUrl).toBeTruthy();
  expect(text).toContain("/components/buttons");
  expect(text).not.toContain("/components\\");

  const buttons = await fetch(new URL("/components/buttons", serverUrl));
  expect(buttons.status).toBe(200);
  expect(await buttons.text()).toContain("<title>Buttons</title>");
});

const page = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body></body></html>`;

// Replaces `Bun.serve`: a run prints the pages that it serves, then exits. The pages are sorted before that, and a
// debug build takes a second to load the collation data for it, so they are sorted without it.
const printPages = /*js*/ `
  String.prototype.localeCompare = function (other) {
    return this < other ? -1 : this > other ? 1 : 0;
  };
  Bun.serve = options => {
    console.log(JSON.stringify(Object.values(options.routes).map(page => page.index)));
    process.exit(0);
  };
`;

// What `bun <how> --preload print-pages.js <args>` serves in `cwd`, or how it fails.
async function pagesServed(root: string, cwd: string, how: string[], args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...how, "--preload", join(root, "print-pages.js"), ...args],
    cwd: join(root, cwd),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const pages: string[] = stdout ? JSON.parse(stdout) : [];
  return {
    pages: pages.map(page => relative(root, page).replaceAll("\\", "/")).sort(),
    error: /Cannot find module|Module not found|ENOENT/.exec(stderr)?.[0],
    exitCode,
  };
}

// The pages of `{a,b}/app` are served. As a pattern, `{a,b}` matches `a`, which has pages with the same names.
describe("pages under a directory named {a,b}", () => {
  const pagesUnder = () =>
    tempDir("html-entry-ünder-braces", {
      "print-pages.js": printPages,
      "push-about.js": /*js*/ `process.argv.push(require("node:path").join(process.cwd(), "about.html"));`,
      "{a,b}/app/index.html": page("index"),
      "{a,b}/app/about.html": page("about"),
      "{a,b}/app/sub/index.html": page("sub"),
      "{a,b}/site/package.json": JSON.stringify({ main: "./index.html" }),
      "{a,b}/site/index.html": page("site"),
      "a/app/index.html": page("not served"),
      "a/app/about.html": page("not served"),
      "a/app/missing.html": page("not served"),
      "a/site/index.html": page("not served"),
    });
  const app = "{a,b}/app";
  const index = [`${app}/index.html`];
  const both = [`${app}/about.html`, `${app}/index.html`];
  type Form = [name: string, cwd: string, how: string[], args: (root: string) => string[], pages: string[]];
  const forms: Form[] = [
    ["bun ./index.html", app, [], () => ["./index.html"], index],
    ["bun index.html", app, [], () => ["index.html"], index],
    ["bun run ./index.html", app, ["run"], () => ["./index.html"], index],
    ["bun <absolute page>", ".", [], root => [join(root, app, "index.html")], index],
    ["bun <page below>", ".", [], () => [`./${app}/index.html`], index],
    ["bun <directory with a package.json>", "{a,b}", [], () => ["./site"], ["{a,b}/site/index.html"]],
    ["bun ./index.html ./about.html", app, [], () => ["./index.html", "./about.html"], both],
    ["bun ./about.html <absolute page>", app, [], root => ["./about.html", join(root, app, "index.html")], both],
    ["bun ./index.html '{about,none}.html'", app, [], () => ["./index.html", "{about,none}.html"], both],
    [
      "a page that a preload adds to process.argv",
      app,
      [],
      root => ["--preload", join(root, "push-about.js"), "./index.html"],
      both,
    ],
    ["node ./index.html", app, ["--bun", "node"], () => ["./index.html"], index],
    // These never had the name of the directory in them.
    ["bun './*.html'", app, [], () => ["./*.html"], both],
    ["bun './**/*.html'", app, [], () => ["./**/*.html"], [...both, `${app}/sub/index.html`]],
  ];
  test.concurrent.each(forms)("%s", async (_, cwd, how, args, pages) => {
    using root = pagesUnder();
    const result = await pagesServed(String(root), cwd, how, args(String(root)));
    expect(result).toEqual({ pages, error: undefined, exitCode: 0 });
  });

  test.concurrent.skipIf(isWindows)("bun <symbolic link to a page>", async () => {
    using root = pagesUnder();
    symlinkSync(join(String(root), app, "index.html"), join(String(root), "link.html"));
    const result = await pagesServed(String(root), ".", [], ["./link.html"]);
    expect(result).toEqual({ pages: index, error: undefined, exitCode: 0 });
  });

  // What does not name a file is read as before.
  type Failure = [name: string, args: (root: string) => string[], error: string];
  const failures: Failure[] = [
    ["bun <absolute page that is missing>", root => [join(root, app, "missing.html")], "Module not found"],
    [
      "bun ./index.html <pattern in a directory that is missing>",
      root => ["./index.html", join(root, "missing", "*.html")],
      "ENOENT",
    ],
    // Not the first: `bun` looks for a file with that name.
    ["bun './{index,about}.html'", () => ["./{index,about}.html"], "Module not found"],
  ];
  test.concurrent.each(failures)("%s", async (_, args, error) => {
    using root = pagesUnder();
    const result = await pagesServed(String(root), app, [], args(String(root)));
    expect(result).toEqual({ pages: [], error, exitCode: 1 });
  });
});

// As a pattern, `p{1}.html` matches `p1.html`, and not the page with that name.
test.concurrent.each([
  [["./p{1}.html"], ["p{1}.html"]],
  [
    ["./index.html", "./p{1}.html"],
    ["index.html", "p{1}.html"],
  ],
])("bun %j serves the page named p{1}.html", async (args, pages) => {
  using root = tempDir("html-entry-named-page", {
    "print-pages.js": printPages,
    "index.html": page("index"),
    "p{1}.html": page("p{1}"),
    "p1.html": page("not served"),
  });
  const result = await pagesServed(String(root), ".", [], args);
  expect(result).toEqual({ pages, error: undefined, exitCode: 0 });
});

// A pattern that matches its own text stays a pattern: it finds the file with that name too.
test.concurrent.skipIf(isWindows)("bun './pages/*.html' beside a page named *.html", async () => {
  using root = tempDir("html-entry-star-page", {
    "print-pages.js": printPages,
    "pages/*.html": page("star"),
    "pages/a.html": page("a"),
    "pages/b.html": page("b"),
  });
  const result = await pagesServed(String(root), ".", [], ["./pages/*.html"]);
  expect(result).toEqual({ pages: ["pages/*.html", "pages/a.html", "pages/b.html"], error: undefined, exitCode: 0 });
});

// The working directory and the path of the page each take more than half of the longest path that Linux has.
const deep = Array.from({ length: 10 }, () => Buffer.alloc(200, "d").toString()).join("/");

test.concurrent.skipIf(!isLinux)("bun ./index.html under {a,b} in a deep directory", async () => {
  using root = tempDir("html-entry-deep", {
    "print-pages.js": printPages,
    [`${deep}/{a,b}/index.html`]: page("index"),
    [`${deep}/a/index.html`]: page("not served"),
  });
  const result = await pagesServed(String(root), `${deep}/{a,b}`, [], ["./index.html"]);
  expect(result).toEqual({ pages: [`${deep}/{a,b}/index.html`], error: undefined, exitCode: 0 });
});

test("which pages an argument names", () => {
  using root = tempDir("html-entry-ärguments", {
    "index.html": "",
    "about.html": "",
    "p{1}.html": "",
    "p1.html": "",
    "{a,b}/index.html": "",
    "a/index.html": "",
    "a/other.html": "",
    ...(isWindows ? {} : { "pages/*.html": "", "pages/a.html": "" }),
    ...(isLinux ? { [`${deep}/{a,b}/index.html`]: "", [`${deep}/a/index.html`]: "" } : {}),
  });
  const pagesOf = (arg: string) =>
    htmlPagesOf(arg, String(root))
      ?.map(page => page.replaceAll("\\", "/"))
      .sort();
  expect({
    "./index.html": pagesOf("./index.html"),
    "./missing.html": pagesOf("./missing.html"),
    "./*.html": pagesOf("./*.html"),
    "{about,none}.html": pagesOf("{about,none}.html"),
    // The path of a page, which the pattern cannot find.
    "./p{1}.html": pagesOf("./p{1}.html"),
    "{a,b}/index.html": pagesOf("{a,b}/index.html"),
    "<absolute>": pagesOf(join(String(root), "{a,b}", "index.html")),
    // No page has that path.
    "p{2}.html": pagesOf("p{2}.html"),
    "{a,b}/other.html": pagesOf("{a,b}/other.html"),
    // Longer than a path can be.
    "<long>": pagesOf(`{${Buffer.alloc(200_000, "a").toString()}}.html`),
  }).toEqual({
    "./index.html": undefined,
    "./missing.html": undefined,
    "./*.html": ["./about.html", "./index.html", "./p1.html", "./p{1}.html"],
    "{about,none}.html": ["about.html"],
    "./p{1}.html": undefined,
    "{a,b}/index.html": undefined,
    "<absolute>": undefined,
    "p{2}.html": [],
    "{a,b}/other.html": ["a/other.html"],
    "<long>": [],
  });
  // A pattern that matches its own text finds the page with that name, and the others.
  if (!isWindows) expect(pagesOf("./pages/*.html")).toEqual(["./pages/*.html", "./pages/a.html"]);
  if (isLinux) {
    const cwd = join(String(root), deep);
    expect(htmlPagesOf(join(cwd, "{a,b}", "index.html"), cwd)).toBeUndefined();
  }
  expect(() => pagesOf(join(String(root), "missing", "*.html"))).toThrow(expect.objectContaining({ code: "ENOENT" }));
});
