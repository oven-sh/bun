import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isMacOS, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

// The `o + Enter` shortcut launches the platform opener (`xdg-open`, `open`, `start`).
// The key handler only runs on a TTY, so the dev server is driven through a pty.
describe("o + Enter", () => {
  const html = `<!DOCTYPE html><html><body><h1>hi</h1></body></html>`;

  // Polls with a deadline: the condition is reached in milliseconds or not at all.
  async function until(what: () => string, condition: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out: ${what()}`);
      await Bun.sleep(10);
    }
  }

  // Boots the dev server on a pty. With `stderrFile`, the server's stderr goes to that file and
  // colours stay on, so the pty carries the coloured banner and the key echoes only.
  async function devServerInPty(cwd: string, PATH: string, stderrFile?: string, entries = ["index.html"]) {
    const decoder = new TextDecoder();
    let text = "";
    const waiters: { needle: string; from: number; resolve: () => void; reject: (error: Error) => void }[] = [];
    const closed = Promise.withResolvers<void>();
    const bun = [bunExe(), ...entries, "--port=0", "--hostname=127.0.0.1"];
    // On Windows the inherited variable is spelled `Path`, and in a plain spread it would win.
    const env = mergeWindowEnvs([bunEnv, { PATH, STDERR_FILE: stderrFile, TERM: stderrFile && "xterm-256color" }]);
    if (stderrFile) delete env.NO_COLOR;
    const proc = Bun.spawn({
      cmd: stderrFile ? ["/bin/sh", "-c", 'exec "$0" "$@" 2> "$STDERR_FILE"', ...bun] : bun,
      env,
      cwd,
      terminal: {
        // Wide enough that no line wraps: ConPTY redraws a wrapped line.
        cols: 200,
        rows: 50,
        data(_terminal, chunk) {
          text += decoder.decode(chunk, { stream: true });
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (text.indexOf(waiters[i].needle, waiters[i].from) !== -1) waiters.splice(i, 1)[0].resolve();
          }
        },
        exit() {
          closed.resolve();
        },
      },
    });
    // An early exit fails the wait instead of hanging. The last output can arrive
    // after the exit, so the message is built once the pty has closed.
    proc.exited.then(async code => {
      await closed.promise;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error(`server exited with ${code} before ${JSON.stringify(waiter.needle)}:\n${text}`));
      }
    });
    const waitFor = (needle: string, from = 0) => {
      if (text.indexOf(needle, from) !== -1) return Promise.resolve();
      if (proc.exitCode !== null) return Promise.reject(new Error(`server exited with ${proc.exitCode}:\n${text}`));
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      waiters.push({ needle, from, resolve, reject });
      return promise;
    };
    const stderr = () => (stderrFile && existsSync(stderrFile) ? readFileSync(stderrFile, "utf8") : "");
    // Polls the stderr file until it holds `needle` `count` times. An exit of the server ends the wait.
    const stderrHas = (needle: string, count: number) =>
      until(
        () => `${count} of ${JSON.stringify(needle)} on stderr, got ${JSON.stringify(stderr())}`,
        () => {
          if (proc.exitCode !== null) throw new Error(`server exited with ${proc.exitCode}:\n${stderr()}`);
          return stderr().split(needle).length > count;
        },
      );
    try {
      // The shortcut hint is the last line of the banner, so the URL line is complete by then.
      await waitFor("h + Enter");
      // ConPTY can put an escape sequence right after the text of a line.
      const url = Bun.stripANSI(text).match(/(?:url:|➜) (\S+)/)?.[1];
      if (!url) throw new Error(`no URL on the banner: ${JSON.stringify(text)}`);
      return {
        proc,
        // The URL on the banner, and its origin.
        url,
        origin: new URL(url).origin,
        port: Number(new URL(url).port),
        waitFor,
        closed: closed.promise,
        text: () => text,
        stderr,
        mark: () => text.length,
        // Enter is a carriage return: a Windows console read only completes a line on one.
        press: (key: string) => void proc.terminal!.write(`${key}\r`),
        stderrHas,
        // Waits for the note line of `count` failed launches.
        reported: (count: number) => stderrHas("in your browser\n", count),
        async [Symbol.asyncDispose]() {
          proc.kill();
          await proc.exited;
        },
      };
    } catch (error) {
      // The caller has nothing to dispose yet.
      proc.kill();
      await proc.exited;
      throw error;
    }
  }

  // On Windows the opener is `start`, which is not a program, so every press takes this path
  // there (#26231). The test relies on the opener being looked up on PATH (bare `open` on macOS),
  // and needs a new setup once Windows has a real opener. Android launches an absolute path.
  test.concurrent.skipIf(isAndroid)(
    "reports the error on stderr and keeps serving when the opener cannot be launched",
    async () => {
      using dir = tempDir("html-open-missing", { "index.html": html, "empty-bin/.keep": "" });
      // POSIX: as in `bun index.html 2> err.log` on a terminal. stdout is a coloured pty, stderr is a file.
      const stderrFile = isWindows ? undefined : join(String(dir), "stderr.txt");
      await using server = await devServerInPty(String(dir), join(String(dir), "empty-bin"), stderrFile);
      const opener = isWindows ? "start" : isMacOS ? "open" : "xdg-open";
      const report = `error: Executable not found in $PATH: "${opener}"\nnote: Open ${server.url} in your browser\n`;

      // The next key must not go out before a press is reported in full.
      for (let press = 1; press <= 2; press++) {
        const from = server.mark();
        server.press("o");
        if (stderrFile) await server.reported(press);
        else await server.waitFor("in your browser", from);
      }

      // The listener still accepts a connection, and the server still exits on request.
      const socket = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } });
      socket.end();
      server.press("q");
      expect(await server.proc.exited).toBe(0);
      await server.closed;

      const shown = Bun.stripANSI(server.text());
      if (isWindows) {
        // ConPTY redraws its output, so only the two lines are checked there.
        const [error, note] = report.trimEnd().split("\n");
        expect(shown).toContain(error);
        expect(shown).toContain(note);
      } else {
        expect({ stderr: server.stderr(), terminalAfterBanner: shown.split("to show shortcuts\r\n")[1] }).toEqual({
          // Two lines per press, and no colour: stderr is not a terminal here.
          stderr: report + report,
          // Nothing went to stdout: the terminal shows only the echo of each key.
          terminalAfterBanner: "o\r\no\r\nq\r\n",
        });
      }
    },
  );

  // With several entries and no index route, the root is not a page. The banner names the
  // first route, and `o` must open that page.
  test.concurrent.skipIf(isAndroid)("opens the page on the banner when no entry is the index", async () => {
    using dir = tempDir("html-open-routes", { "about.html": html, "contact.html": html, "empty-bin/.keep": "" });
    const stderrFile = isWindows ? undefined : join(String(dir), "stderr.txt");
    // `./`: a bare name after the first entry is looked up as a package before it is read as a file.
    const entries = ["about.html", "./contact.html"];
    await using server = await devServerInPty(String(dir), join(String(dir), "empty-bin"), stderrFile, entries);
    expect(server.url).toBe(`${server.origin}/about`);

    // With no opener on PATH, the note line shows the URL that `o` hands to the opener.
    const from = server.mark();
    server.press("o");
    if (stderrFile) await server.reported(1);
    else await server.waitFor("in your browser", from);
    const shown = stderrFile ? server.stderr() : Bun.stripANSI(server.text().slice(from));
    expect(shown).toContain(`note: Open ${server.origin}/about in your browser`);
    expect({
      page: (await fetch(server.url)).status,
      root: (await fetch(`${server.origin}/`)).status,
    }).toEqual({ page: 200, root: 404 });

    server.press("q");
    expect(await server.proc.exited).toBe(0);
  });

  // A fake opener needs a shebang script, so this case is POSIX-only. The opener inherits
  // stderr, so the line it writes there is the signal that it ran.
  // The first route comes from a file name that parses as a URL: the page must stay on the
  // server origin, or the file name would choose what the opener is given.
  test.concurrent.skipIf(isWindows || isAndroid)(
    "gives the opener the banner URL and /dev/null, and neither waits for it nor reports its exit",
    async () => {
      const opener = isMacOS ? "open" : "xdg-open";
      using dir = tempDir("html-open-fake", { "mailto:me.html": html, "other.html": html, "mode": "3\n" });
      const modeFile = join(String(dir), "mode");
      const releaseFile = join(String(dir), "release");
      mkdirSync(join(String(dir), "bin"));
      // The mode file says how the opener ends: an exit code, or `hold` to stay alive until released.
      writeFileSync(
        join(String(dir), "bin", opener),
        `#!/bin/sh
read mode < ${JSON.stringify(modeFile)}
if [ -t 0 ]; then in=tty; elif [ /dev/fd/0 -ef /dev/null ]; then in=null; else in=other; fi
if [ -t 1 ]; then out=tty; elif [ /dev/fd/1 -ef /dev/null ]; then out=null; else out=other; fi
echo "FAKE_OPENER pid=$$ stdin=$in stdout=$out url=$1 mode=$mode" >&2
if [ "$mode" = hold ]; then
  i=0
  while [ ! -e ${JSON.stringify(releaseFile)} ] && [ $i -lt 300 ]; do /bin/sleep 0.05; i=$((i+1)); done
  exit 0
fi
exit "$mode"
`,
        { mode: 0o755 },
      );
      const entries = ["mailto:me.html", "./other.html"];
      await using server = await devServerInPty(
        String(dir),
        join(String(dir), "bin"),
        join(String(dir), "stderr.txt"),
        entries,
      );
      expect(server.url).toBe(`${server.origin}/mailto:me`);

      // Presses `o` and returns the pid of the opener that bun launched for it.
      let presses = 0;
      async function open(mode: string) {
        writeFileSync(modeFile, `${mode}\n`);
        server.press("o");
        await server.stderrHas("\n", ++presses);
        return Number(
          server
            .stderr()
            .trimEnd()
            .split("\n")
            .at(-1)!
            .match(/pid=(\d+)/)![1],
        );
      }
      // A zombie still answers signal 0, so ESRCH means bun has reaped the opener.
      const reaped = (pid: number) =>
        until(
          () => `opener ${pid} is reaped`,
          () => {
            try {
              process.kill(pid, 0);
              return false;
            } catch (error: any) {
              if (error.code !== "ESRCH") throw error;
              return true;
            }
          },
        );

      // An opener that fails, then two that stay alive: the second one shows that the server
      // still answers a key while an opener runs.
      await reaped(await open("3"));
      const held = [await open("hold"), await open("hold")];
      writeFileSync(releaseFile, "");
      await Promise.all(held.map(reaped));
      server.press("q");
      expect(await server.proc.exited).toBe(0);
      await server.closed;

      const marker = (mode: string) => `FAKE_OPENER pid=<pid> stdin=null stdout=null url=${server.url} mode=${mode}\n`;
      expect({
        stderr: server.stderr().replace(/pid=\d+/g, "pid=<pid>"),
        terminalAfterBanner: Bun.stripANSI(server.text()).split("to show shortcuts\r\n")[1],
      }).toEqual({
        // Each opener's own line and nothing from bun: not for exit code 3, not while one runs.
        stderr: marker("3") + marker("hold") + marker("hold"),
        // Nothing went to stdout either: the terminal shows only the echo of each key.
        terminalAfterBanner: "o\r\no\r\no\r\nq\r\n",
      });
    },
  );
});
