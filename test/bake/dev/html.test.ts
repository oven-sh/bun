// HTML tests are tests relating to HTML files themselves.
import { devTest, emptyHtmlFile } from "../bake-harness";

devTest("html file is watched", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Hello</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    await dev.patch("index.html", {
      find: "Hello",
      replace: "World",
    });
    await dev.fetch("/").expect.toInclude("<h1>World</h1>");

    // Works
    await using c = await dev.client("/");
    await c.expectMessage("hello");

    // Editing HTML reloads
    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: "World",
        replace: "Hello",
      });
      await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    });
    await c.expectMessage("hello");

    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: "Hello",
        replace: "Bar",
      });
      await dev.fetch("/").expect.toInclude("<h1>Bar</h1>");
    });
    await c.expectMessage("hello");

    await c.expectReload(async () => {
      await dev.patch("script.ts", {
        find: "hello",
        replace: "world",
      });
    });
    await c.expectMessage("world");
  },
});

devTest("image tag", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <img src="image.png" alt="test image">
      </body></html>
    `,
    "image.png": "FIRST",
  },
  async test(dev) {
    await using c = await dev.client("/");

    const url: string = await c.js`document.querySelector("img").src`;
    expect(url).toBeString(); // image tag exists
    await dev.fetch(url).expect.toBe("FIRST");

    // Editing HTML causes reload but image still works
    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: 'alt="test image"',
        replace: 'alt="modified image"',
      });
      await dev.fetch("/").expect.toInclude('alt="modified image"');
    });

    // Editing image content causes a hard reload because the html must reflect the new image content
    await c.expectReload(async () => {
      await dev.patch("image.png", {
        find: "FIRST",
        replace: "SECOND",
      });
    });

    const url2 = await c.js`document.querySelector("img").src`;
    expect(url).not.toBe(url2);
    await dev.fetch(url2).expect.toBe("SECOND");

    await dev.fetch(url).expect404(); // TODO
  },
});
devTest("image import in JS", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <script type="module" src="script.ts"></script>
      </body></html>
    `,
    "script.ts": `
      import img from "./image.png";
      console.log(img);
    `,
    "image.png": "FIRST",
  },
  async test(dev) {
    await using c = await dev.client("/");

    const img1 = await c.getStringMessage();
    await dev.fetch(img1).expect.toBe("FIRST");

    // Editing image content updates the image URL
    await c.expectReload(async () => {
      await dev.patch("image.png", {
        find: "FIRST",
        replace: "SECOND",
      });
    });

    const img2 = await c.getStringMessage();
    await dev.fetch(img2).expect.toBe("SECOND");
    // await dev.fetch(img1).expect404();
  },
});
devTest("import then create", {
  files: {
    "index.html": `
      <!DOCTYPE html>
      <html>
      <head></head>
      <body>
        <script type="module" src="/script.ts"></script>
      </body>
      </html>
    `,
    "script.ts": `
      import data from "./data";
      console.log(data);
    `,
  },
  async test(dev) {
    const c = await dev.client("/", {
      errors: ['script.ts:1:18: error: Could not resolve: "./data"'],
    });
    await c.expectReload(async () => {
      await dev.write("data.ts", "export default 'data';");
    });
    await c.expectMessage("data");
  },
});
devTest("external links", {
  files: {
    "index.html": `
      <!doctype html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>index | Powered by Bun</title>
        <link rel="stylesheet" href="./index.css" />
        <link rel="icon" type="image/x-icon" href="https://bun.sh/favicon.ico" />
      </head>
      <body>
        <div id="root"></div>
        <script src="./index.client.tsx" type="module"></script>
      </body>
      </html>
    `,
    "index.css": `
      body {
        background-color: red;
      }
    `,
    "index.client.tsx": `
      console.log("hello");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");

    const ico: string = await c.js`document.querySelector("link[rel='icon']").href`;
    expect(ico).toBe("https://bun.sh/favicon.ico");
  },
});
devTest("memory leak case 1", {
  files: {
    "index.html": `
      <script type="module" src="/script.ts"></script>
    `,
    "script.ts": `
      import data from "./data";
    `,
  },
  async test(dev) {
    await dev.fetch("/"); // previously leaked source map
  },
});

devTest("chrome devtools automatic workspace folders", {
  files: {
    "index.html": `
      <script type="module" src="/script.ts"></script>
    `,
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/.well-known/appspecific/com.chrome.devtools.json");
    expect(response.status).toBe(200);
    const json = await response.json();
    const root = dev.join(".");
    expect(json).toMatchObject({
      workspace: {
        root,
        uuid: expect.any(String),
      },
    });
  },
});
