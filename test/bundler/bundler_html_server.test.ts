import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
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
    // Regression test for https://github.com/oven-sh/bun/issues/23431
    // HTML imports at nested paths should use absolute paths for JS/CSS chunks
    itBundled(`compile/${backend}/HTMLServerNestedRouteAbsolutePaths`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
        import index from "./index.html";

        using server = Bun.serve({
          port: 0,
          routes: {
            "/*": index,
          },
          fetch(req) {
            return new Response("Not found", { status: 404 });
          },
        });

        // Fetch the HTML served at a nested path
        const res = await fetch(new URL("/foo/bar", server.url));
        const html = await res.text();

        // Verify the HTML contains script/link tags with absolute paths (starting with "/")
        // not relative paths (starting with "./")
        const scriptMatch = html.match(/src="([^"]+)"/);
        const linkMatch = html.match(/href="([^"]+)"/);

        const scriptSrc = scriptMatch?.[1] ?? "";
        const linkHref = linkMatch?.[1] ?? "";

        console.log("Script src starts with /:", scriptSrc.startsWith("/"));
        console.log("Link href starts with /:", linkHref.startsWith("/"));

        // Verify the JS chunk is actually fetchable at the absolute path
        const jsRes = await fetch(new URL(scriptSrc, server.url));
        console.log("JS chunk status:", jsRes.status);
        console.log("JS chunk content-type:", jsRes.headers.get("content-type")?.includes("javascript"));

        // Verify the CSS chunk is actually fetchable at the absolute path
        const cssRes = await fetch(new URL(linkHref, server.url));
        console.log("CSS chunk status:", cssRes.status);
        console.log("CSS chunk content-type:", cssRes.headers.get("content-type")?.includes("css"));
      `,
        "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <link rel="stylesheet" href="./styles.css">
          </head>
          <body>
            <h1>Hello</h1>
            <script type="module" src="./client.ts" async></script>
          </body>
        </html>
      `,
        "/styles.css": /* css */ `
        body {
          background: blue;
        }
      `,
        "/client.ts": /* js */ `
        console.log("client code loaded");
      `,
      },
      run: {
        stdout:
          "Script src starts with /: true\nLink href starts with /: true\nJS chunk status: 200\nJS chunk content-type: true\nCSS chunk status: 200\nCSS chunk content-type: true",
      },
    });
  }
});
