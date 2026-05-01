// TODO: full server-side support
// import { SveltePlugin } from "bun-plugin-svelte";
// import { render } from "svelte/server";
// import { bunRun, bunEnv, bunExe } from "harness";
// import path from "path";
// // import { describe, beforeEach, afterEach, it, expect } from "bun:test";

// const fixturePath = (...segs: string[]) => path.join(__dirname, "fixtures", ...segs);

// // await Bun.plugin(SveltePlugin({ development: true }));

// // import TodoApp from "./fixtures/todo-list.svelte";

// // afterAll(() => {
// //   Bun.plugin.clearAll();
// // })

// describe("When bun-plugin-svelte is enabled via Bun.plugin()", () => {
//   // beforeEach(async () => {
//   //   await Bun.plugin(SveltePlugin({ development: true }));
//   // });

//   // afterEach(() => {
//   //   Bun.plugin.clearAll();
//   // });

//   it("can render() production builds", async () => {
//     const result = Bun.spawnSync([bunExe(), "--preload=./server-imports.preload.ts", "server-imports.ts"], {
//       cwd: fixturePath(),
//       env: bunEnv,
//     });
//     if (result.exitCode !== 0) {
//       console.error(result.stderr.toString("utf8"));
//       throw new Error("rendering failed");
//     }
//     expect(result.exitCode).toBe(0);

//     // const { default: TodoApp } = await import("./fixtures/todo-list.svelte");
//     // expect(TodoApp).toBeTypeOf("function");
//     // const result = render(TodoApp);
//     // expect(result).toMatchObject({ head: expect.any(String), body: expect.any(String) });
//     // expect(result).toMatchSnapshot();
//   });

//   it("can render() development builds", async () => {
//     const result = Bun.spawnSync([bunExe(), "--preload=./server-imports.preload.ts", "server-imports.ts"], {
//       cwd: fixturePath(),
//       env: {
//         ...bunEnv,
//         NODE_ENV: "development",
//       }
//     });
//     if (result.exitCode !== 0) {
//       console.error(result.stderr.toString("utf8"));
//       throw new Error("rendering failed");
//     }
//     expect(result.exitCode).toBe(0);

//     // // const { default: TodoApp } = await import("./fixtures/todo-list.svelte");
//     // const result = render(TodoApp);
//     // expect(result).toMatchObject({ head: expect.any(String), body: expect.any(String) });
//     // expect(result).toMatchSnapshot();
//   });

//   // FIXME: onResolve is not called for CSS imports on server-side
//   it.skip("if forced to use client-side generation, could be used with happy-dom in Bun", () => {
//     expect(() => bunRun(fixturePath("client-code-on-server.ts"), { NODE_ENV: "development" })).not.toThrow();
//   })
// });

// // describe("When using Bun.build()", () => {

// // });
