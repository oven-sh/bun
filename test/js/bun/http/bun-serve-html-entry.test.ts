import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

async function getServerUrl(process: Subprocess) {
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
  const dir = tempDirWithFiles("html-entry-test", {
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
  const dir = tempDirWithFiles("html-multiple-entries-test", {
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
  const dir = tempDirWithFiles("html-glob-test", {
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
  const dir = tempDirWithFiles("svg-content-type-test", {
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
  const dir = tempDirWithFiles("content-type-test", {
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
