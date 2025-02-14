// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework, reactRefreshStub } from "../dev-server-harness";

devTest("css file with syntax error does not kill old styles", {
  files: {
    "styles.css": `
      body {
        color: red;
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color
        }
      `,
      {
        errors: ["styles.css:4:1: error: Unexpected end of input"],
      },
    );
    await client.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color: blue;
        }
      `,
    );
    await client.style("body").backgroundColor.expect.toBe("#00f");
    await dev.write("styles.css", ` `, { dedent: false });
    await client.style("body").notFound();
  },
});
devTest("css file with initial syntax error gets recovered", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
    "styles.css": `
      body {
        color: red;
      }}
    `,
  },
  async test(dev) {
    await using client = await dev.client("/", {
      errors: ["styles.css:3:3: error: Unexpected end of input"],
    });
    // hard reload to dismiss the error overlay
    await client.expectReload(async () => {
      await dev.write(
        "styles.css",
        `
          body {
            color: red;
          }
        `,
      );
    });
    await client.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }
      `,
    );
    await client.style("body").color.expect.toBe("#00f");
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }}
      `,
      {
        errors: ["styles.css:3:3: error: Unexpected end of input"],
      },
    );
  },
});
devTest("add new css import later", {
  files: {
    ...reactRefreshStub,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts", "react-refresh/runtime"],
      body: `hello world`,
    }),
    "index.ts": `
      // import "./styles.css";
      export default function () {
        return "hello world";
      }
    `,
    "styles.css": `
      body {
        color: red;
      }
    `,
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.style("body").notFound();
    await dev.patch("index.ts", { find: "// import", replace: "import" });
    await client.style("body").color.expect.toBe("red");
    await dev.patch("index.ts", { find: "import", replace: "// import" });
    await client.style("body").notFound();
  },
});

// TODO: revive these tests for server components. they fail because some assertion.
// devTest("css file with syntax error does not kill old styles", {
//   framework: minimalFramework,
//   files: {
//     "routes/styles.css": `
//       body {
//         color: red;
//       }
//     `,
//     "routes/index.ts": `
//       import { expect } from 'bun:test';
//       import './styles.css';

//       export default function (req, meta) {
//         expect(meta.styles).toHaveLength(1);
//         return new Response(meta.styles[0]);
//       }
//     `,
//   },
//   async test(dev) {
//     let css_url = await dev.fetch("/").text();
//     await dev.fetch(css_url).equalsNoSpaces("/*routes/styles.css*/body{color:red;}");
//     await dev.write(
//       "routes/styles.css",
//       `
//         body {
//           color: red;
//           background-color
//         }
//       `,
//     );
//     await dev.fetch(css_url).equalsNoSpaces("/*routes/styles.css*/body{color:red;}");
//     await dev.fetch("/").equals(css_url);
//     await dev.write(
//       "routes/styles.css",
//       `
//         body {
//           color: red;
//           background-color: blue;
//         }
//       `,
//     );
//     await dev.fetch(css_url).equalsNoSpaces("/*routes/styles.css*/body{color:red;background-color:#00f;}");
//     await dev.fetch("/").equals(css_url);
//     await dev.write("routes/styles.css", ` `);
//     await dev.fetch(css_url).equalsNoSpaces("/*routes/styles.css*/");
//     await dev.fetch("/").equals(css_url);
//   },
// });
// devTest("css file with initial syntax error gets recovered", {
//   framework: minimalFramework,
//   files: {
//     "routes/styles.css": `
//       body {
//         color: red;
//     `,
//     "routes/index.ts": `
//       import { expect } from 'bun:test';
//       import './styles.css';
//       export default function (req, meta) {
//         const input = req.json();
//         expect(meta.styles).toHaveLength(input.len);
//         return new Response('' + meta.styles[0]);
//       }
//     `,
//   },
//   async test(dev) {
//     await dev.fetchJSON("/", { len: 1 }).equals("undefined");
//   },
// });

devTest("fuzz case 1", {
  files: {
    "styles.css": `
      body {
        background-image: url
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);
    // previously: panic(main thread): Asset double unref: 0000000000000000
    await dev.patch("styles.css", { find: "url\n", replace: "url(\n" });
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
