// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { devTest, minimalFramework } from "../dev-server-harness";

devTest("html file is watched", {
  files: {
    "index.html": `
      <html>
      <head></head>
      <body>
        <h1>Hello</h1>
        <script type="module" src="/script.ts"></script>
      </body>
      </html>
    `,
    "script.ts": `
      harness.send("hello");
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

    const client = dev.client("/");
  },
});
