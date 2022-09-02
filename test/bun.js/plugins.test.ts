import { it, expect, describe } from "bun:test";

// Bun.plugin({
//   name: "svelte loader",
//   setup(builder) {
//     var { compile } = require("svelte/compiler");
//     var { readFileSync } = require("fs");
//     builder.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
//       contents: compile(readFileSync(path, "utf8"), {
//         filename: path,
//         generate: "ssr",
//       }).js.code,
//       loader: "js",
//     }));
//   },
// });

// it("SSRs `<h1>Hello world!</h1>` with Svelte", async () => {
//   const { default: App } = await import("./hello.svelte");
//   const { html } = App.render();

//   expect(html).toBe("<h1>Hello world!</h1>");
// });

Bun.plugin({
  name: "boop beep beep",
  setup(builder) {
    builder.onResolve({ filter: /boop/, namespace: "beep" }, () => ({
      path: "boop",
      namespace: "beep",
    }));

    builder.onLoad({ filter: /boop/, namespace: "beep" }, () => ({
      contents: `export default 42;`,
      loader: "js",
    }));
  },
});

it("beep:boop returns 42", async () => {
  const result = await import("beep:boop");
  expect(result.default).toBe(42);
});

// plugin({
//   name: "test",
//   setup(builder) {
//     builder.onResolve(
//       { filter: /my-plugin/, namespace: "hello" },
//       ({ path }) => ({
//         path,
//         namespace: "hello",
//       })
//     );

//     builder.onLoad({ filter: /my-plugin/, namespace: "hello" }, () => ({
//       code: "export default 'world'",
//       loader: "js",
//     }));
//   },
// });

// describe("the two kinds of loader plugins", () => {
//   describe("1. namespaced plugins", async () => {
//     it("the import path must have a namespace: prefix in front", async () => {
//       const result = await import("hello:my-plugin");
//       expect(result.default).toBe("world");
//     });
//   });

//   describe("2. File extensions", () => {
//     it("A '.' is necessary", async () => {
//       const { default: App } = await import("./hello.svelte");
//       const { head, html, css } = App.render({
//         answer: 42,
//       });

//       expect(html).toBe("<h1>Hello world!</h1>");
//     });
//   });
// });
