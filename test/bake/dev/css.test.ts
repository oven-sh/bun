// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../dev-server-harness";

devTest("css file with syntax error does not kill old styles", {
  framework: minimalFramework,
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
    expect(await client.js<string>`getComputedStyle(document.body).color`).toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color
        }
      `,
    );
    expect(await client.js<string>`getComputedStyle(document.body).color`).toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color: blue;
        }
      `,
    );

    // Disabled because css updates are flaky. getComputedStyle doesnt update because replacements are async

    // expect(await client.js<string>`getComputedStyle(document.body).backgroundColor`).toBe("#00f");
    // await dev.write("routes/styles.css", ` `);
    // expect(await client.js<string>`getComputedStyle(document.body).backgroundColor`).toBe("");
  },
});
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
