// CSS tests concern bundling bugs with CSS files
import { devTest, minimalFramework } from "../dev-server-harness";

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
//     await dev.fetch(css_url).expectNoSpaces("/*routes/styles.css*/body{color:red;}");
//     await dev.write(
//       "routes/styles.css",
//       `
//         body {
//           color: red;
//           background-color
//         }
//       `,
//     );
//     await dev.fetch(css_url).expectNoSpaces("/*routes/styles.css*/body{color:red;}");
//     await dev.fetch("/").expect(css_url);
//     await dev.write(
//       "routes/styles.css",
//       `
//         body {
//           color: red;
//           background-color: blue;
//         }
//       `,
//     );
//     await dev.fetch(css_url).expectNoSpaces("/*routes/styles.css*/body{color:red;background-color:#00f;}");
//     await dev.fetch("/").expect(css_url);
//     await dev.write("routes/styles.css", ` `);
//     await dev.fetch(css_url).expectNoSpaces("/*routes/styles.css*/");
//     await dev.fetch("/").expect(css_url);
//   },
// });
// devTest('css file with initial syntax error gets recovered', {
//   framework: minimalFramework,
//   files: {
//     'routes/styles.css': `
//       body {
//         color: red;
//     `,
//     'routes/index.ts': `
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
//     await dev.fetchJSON('/', { len: 1 }).expect('undefined');
//   },
// });
