import { describe } from "bun:test";
import { isWindows } from "harness";
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

    // The compiled server registers each embedded file under its output path.
    // That path is a file name: a leading ":" or "*" does not make it a route
    // parameter or a wildcard, so the file answers only its own path. Windows
    // cannot have the source files of this fixture on disk.
    if (!isWindows) {
      itBundled(`compile/${backend}/HTMLServerAssetNamesThatReadAsRoutePatterns`, {
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
            fetch: () => new Response("no route", { status: 404 }),
          });

          const html = await (await fetch(server.url)).text();
          const paths = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
          for (const path of [...paths, "/about", "/favicon.ico", "/a/b"]) {
            const res = await fetch(new URL(path, server.url));
            console.log(path.replace(/-[a-z0-9]+\\.png$/, ".png"), res.status, await res.text());
          }
        `,
          "/index.html": /* html */ `
          <!DOCTYPE html>
          <html>
            <body>
              <img src="./:smile:.png">
              <img src="./*.png">
              <img src="./plain.png">
            </body>
          </html>
        `,
          "/:smile:.png": "colon",
          "/*.png": "star",
          "/plain.png": "plain",
        },
        run: {
          stdout: [
            "/:smile:.png 200 colon",
            "/*.png 200 star",
            "/plain.png 200 plain",
            "/about 404 no route",
            "/favicon.ico 404 no route",
            "/a/b 404 no route",
          ].join("\n"),
        },
      });
    }

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
});
