import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe.concurrent("bundler", () => {
  for (const backend of ["api", "cli"] as const) {
    itBundled(`compile/${backend}/HTMLServerBasic`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import index from "./index.html";
        
        using server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
          },
        });
        
        const res = await fetch(server.url);
        console.log("Status:", res.status);
        console.log("Content-Type:", res.headers.get("content-type"));
        
        const html = await res.text();
        console.log("Has HTML tag:", html.includes("<html>"));
        console.log("Has h1:", html.includes("Hello HTML"));
      
      `,
        "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>Hello HTML</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/styles.css": /* css */ `
        body {
          background: blue;
        }
      `,
        "/app.js": /* js */ `
        console.log("Client app loaded");
      `,
      },
      run: {
        stdout: "Status: 200\nContent-Type: text/html;charset=utf-8\nHas HTML tag: true\nHas h1: true",
      },
    });

    itBundled(`compile/${backend}/HTMLServerMultipleRoutes`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import home from "./home.html";
        import about from "./about.html";
        
        using server = Bun.serve({
          port: 0,
          routes: {
            "/": home,
            "/about": about,
          },
        });
        
        // Test home route
        const homeRes = await fetch(server.url);
        console.log("Home status:", homeRes.status);
        const homeHtml = await homeRes.text();
        console.log("Home has content:", homeHtml.includes("Home Page"));
        
        // Test about route  
        const aboutRes = await fetch(server.url + "about");
        console.log("About status:", aboutRes.status);
        const aboutHtml = await aboutRes.text();
        console.log("About has content:", aboutHtml.includes("About Page"));
      `,
        "/home.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Home</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>Home Page</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/about.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>About</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>About Page</h1>
            <script src="./app.js"></script>
          </body>
        </html>
      `,
        "/styles.css": /* css */ `
        body {
          margin: 0;
          font-family: sans-serif;
        }
      `,
        "/app.js": /* js */ `
        console.log("App loaded");
      `,
      },
      run: {
        stdout: "Home status: 200\nHome has content: true\nAbout status: 200\nAbout has content: true",
      },
    });
  }

  // The page, the script and the stylesheet hold the name of an asset as it is.
  // A client's URL parser escapes a space and a non-ASCII letter before the
  // request leaves, and the built server has to answer that spelling for each
  // file of the page's manifest, with the methods the file has: GET and HEAD.
  // With the page at "/*" a miss is not a 404: the page answers in place of its
  // image, as it does for another method.
  const otherMethods = "HEAD 200 image/png POST 200 text/html;charset=utf-8";
  itBundled("compile/HTMLServerAssetRequestSpellings", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        import index from "./index.html";

        using server = Bun.serve({
          port: 0,
          routes: {
            "/*": index,
          },
        });

        const text = async (ref: string) => await (await fetch(new URL(ref, server.url))).text();
        const html = await text("/");
        const names = [
          ...html.matchAll(/<img src="([^"]+)"/g),
          ...(await text(html.match(/<link[^>]* href="([^"]+)"/)![1])).matchAll(/url\\("?([^")]+)"?\\)/g),
          ...(await text(html.match(/<script[^>]* src="([^"]+)"/)![1])).matchAll(/"(\\/[^"]+\\.png)"/g),
        ].map(match => match[1]);
        const lines: string[] = [];
        for (const name of names) {
          // What the URL parser of a client makes of the name.
          const path = name.replaceAll(" ", "%20").replaceAll("ü", "%C3%BC").replaceAll("ï", "%C3%AF");
          const line: (string | number | null)[] = [path.replace(/-[a-z0-9]+\\.png$/, ".png")];
          for (const method of ["GET", "HEAD", "POST"]) {
            const response = await fetch(server.url.origin + path, { method });
            const body = await response.text();
            line.push(method, response.status, response.headers.get("content-type"));
            if (method === "GET") line.push(body.length > 64 ? body.length : body);
          }
          lines.push(line.join(" "));
        }
        // console.log() reads "%" in its first argument as a format.
        process.stdout.write(lines.join("\\n"));
      `,
      "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./style.css">
          </head>
          <body>
            <img src="./my img.png">
            <img src="./ünï.png">
            <script type="module" src="./app.ts"></script>
          </body>
        </html>
      `,
      "/style.css": /* css */ `
        body {
          background: url("./bg ünï.png");
        }
      `,
      "/app.ts": /* js */ `
        import photos from "./fünf photos.png";
        import literal from "./a%20b.png";
        console.log(photos, literal);
      `,
      "/my img.png": "html, space",
      "/ünï.png": "html, non-ASCII",
      // Under 128 KB the bundler writes a url() as a data: URL.
      "/bg ünï.png": Buffer.alloc(129 * 1024, "c"),
      "/fünf photos.png": "js, non-ASCII and space",
      // The name is these nine bytes. A client sends them as they are.
      "/a%20b.png": "js, literal escape",
    },
    run: {
      stdout: [
        `/my%20img.png GET 200 image/png html, space ${otherMethods}`,
        `/%C3%BCn%C3%AF.png GET 200 image/png html, non-ASCII ${otherMethods}`,
        `/bg%20%C3%BCn%C3%AF.png GET 200 image/png ${129 * 1024} ${otherMethods}`,
        `/f%C3%BCnf%20photos.png GET 200 image/png js, non-ASCII and space ${otherMethods}`,
        `/a%20b.png GET 200 image/png js, literal escape ${otherMethods}`,
      ].join("\n"),
    },
  });
});
