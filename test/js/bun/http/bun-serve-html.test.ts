import { Subprocess } from "bun";
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
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
