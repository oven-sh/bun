// import { AsyncLocalStorage } from "async_hooks";
import { describe, expect, test } from "bun:test";

describe("async context passes through", () => {
  test("syncronously", () => {
    console.log(1);
    // const s = new AsyncLocalStorage();
    // s.run("value", () => {
    //   expect(s.getStore()).toBe("value");
    // });
    // expect(s.getStore()).toBe(undefined);
    // s.run("value", () => {
    //   s.run("second", () => {
    //     expect(s.getStore()).toBe("second");
    //   });
    //   expect(s.getStore()).toBe("value");
    // });
    // expect(s.getStore()).toBe(undefined);
  });
});
//   test("promise.then", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let resolve!: () => void;
//     const promise = new Promise<void>(r => (resolve = r));
//     let v!: string;
//     s.run("value", () => {
//       promise.then(() => {
//         v = s.getStore()!;
//       });
//     });
//     resolve();
//     await promise;
//     expect(v).toBe("value");
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("nested promises", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let resolve!: () => void;
//     let resolve2!: () => void;
//     const promise = new Promise<void>(r => (resolve = r));
//     const promise2 = new Promise<void>(r => (resolve2 = r));
//     let v!: string;
//     const resolved = Promise.resolve(5);
//     s.run("value", () => {
//       promise.then(() => {
//         new Promise<void>(resolve => {
//           setTimeout(() => {
//             resolve();
//           }, 1);
//         }).then(() => {
//           resolved.then(() => {
//             v = s.getStore()!;
//             console.log("bruh", v);
//             resolve2();
//           });
//         });
//       });
//     });
//     resolve();
//     await promise2;
//     expect(v).toBe("value");
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("await", async () => {
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");
//       await 1;
//       expect(s.getStore()).toBe("value");
//     });
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("setTimeout", async () => {
//     let resolve: (x: string) => void;
//     const promise = new Promise<string>(r => (resolve = r));
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", () => {
//       expect(s.getStore()).toBe("value");
//       setTimeout(() => {
//         resolve(s.getStore()!);
//       }, 2);
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toBe("value");
//   });
//   test("setInterval", async () => {
//     let resolve: (x: string[]) => void;
//     const promise = new Promise<string[]>(r => (resolve = r));
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", () => {
//       expect(s.getStore()).toBe("value");
//       const array: string[] = [];
//       const interval = setInterval(() => {
//         array.push(s.getStore()!);
//         if (array.length === 3) {
//           clearInterval(interval);
//           resolve(array);
//         }
//       }, 5);
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toEqual(["value", "value", "value"]);
//   });
//   test("setImmediate", async () => {
//     let resolve: (x: string) => void;
//     const promise = new Promise<string>(r => (resolve = r));
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", () => {
//       expect(s.getStore()).toBe("value");
//       setImmediate(() => {
//         resolve(s.getStore()!);
//       });
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toBe("value");
//   });
//   test("process.nextTick", async () => {
//     let resolve: (x: string) => void;
//     const promise = new Promise<string>(r => (resolve = r));
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", () => {
//       expect(s.getStore()).toBe("value");
//       process.nextTick(() => {
//         resolve(s.getStore()!);
//       });
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toBe("value");
//   });
//   test("queueMicrotask", async () => {
//     let resolve: (x: string) => void;
//     const promise = new Promise<string>(r => (resolve = r));
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", () => {
//       expect(s.getStore()).toBe("value");
//       queueMicrotask(() => {
//         resolve(s.getStore()!);
//       });
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toBe("value");
//   });
//   test("promise catch", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let reject!: () => void;
//     let promise = new Promise<void>((_, r) => (reject = r));
//     let v!: string;
//     s.run("value", () => {
//       promise = promise.catch(() => {
//         v = s.getStore()!;
//       });
//     });
//     reject();
//     await promise;
//     expect(v).toBe("value");
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("promise finally", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let resolve!: () => void;
//     let promise = new Promise<void>(r => (resolve = r));
//     let v!: string;
//     s.run("value", () => {
//       promise = promise.finally(() => {
//         v = s.getStore()!;
//       });
//     });
//     resolve();
//     await promise;
//     expect(v).toBe("value");
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("fetch", async () => {
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");
//       const response = await fetch("https://bun.sh") //
//         .then(r => {
//           expect(s.getStore()).toBe("value");
//           return true;
//         });
//       expect(s.getStore()).toBe("value");
//       expect(response).toBe(true);
//     });
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("Bun.spawn() onExit", async () => {
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");

//       const x = await Bun.spawn({
//         cmd: ["echo", "hello"],
//         onExit(subprocess, exitCode, signalCode, error) {
//           expect(s.getStore()).toBe("value");
//         },
//       });

//       expect(s.getStore()).toBe("value");
//     });
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("Bun.serve", async () => {
//     const s = new AsyncLocalStorage<string>();
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");

//       const server = Bun.serve({
//         port: 0,
//         fetch(request, server) {
//           return new Response(s.getStore()!);
//         },
//       });

//       const response = await fetch(server.hostname + ":" + server.port);
//       expect(await response.text()).toBe("value");

//       expect(s.getStore()).toBe("value");
//     });
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("readable stream 1", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let stream!: ReadableStream;
//     s.run("value", async () => {
//       stream = new ReadableStream({
//         start(controller) {
//           controller.enqueue(s.getStore()!);
//         },
//       });
//     });
//     const result = await stream.getReader().read();
//     expect(result.value).toBe("value");
//     const result2 = await stream.getReader().read();
//     expect(result2.done).toBe(true);
//     expect(s.getStore()).toBe(undefined);
//   });
//   test("Bun.serve + Websocket", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let values_server: string[] = [];
//     let values_client: string[] = [];
//     let resolve: () => void;
//     const promise = new Promise<void>(r => (resolve = r));
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");

//       const server = Bun.serve({
//         port: 0,
//         fetch(request, server) {
//           if (server.upgrade(request)) return null as any;
//           return new Response(s.getStore()!);
//         },
//         websocket: {
//           open(ws) {
//             values_server.push("open:" + s.getStore());
//           },
//           message(ws, message) {
//             values_server.push("message:" + s.getStore());
//             ws.close();
//           },
//           close(ws, code, message) {
//             values_server.push("close:" + s.getStore());
//           },
//         },
//       });

//       const ws = new WebSocket("ws://" + server.hostname + ":" + server.port);
//       ws.addEventListener("open", () => {
//         ws.send("hello");
//         values_client.push("open:" + s.getStore());
//       });
//       ws.addEventListener("close", () => {
//         resolve();
//         values_client.push("close:" + s.getStore());
//       });
//     });
//     expect(s.getStore()).toBe(undefined);
//     await promise;
//     expect(values_server).toEqual(["open:value", "message:value", "close:value", "drain:value"]);
//     expect(values_client).toEqual(["open:value", "close:value"]);
//   });
//   test("node:fs callback", async () => {
//     const fs = require("fs");
//     const s = new AsyncLocalStorage<string>();
//     let resolve: (x: string) => void;
//     const promise = new Promise<string>(r => (resolve = r));
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");
//       fs.readFile(import.meta.path, () => {
//         resolve(s.getStore()!);
//       });
//       expect(s.getStore()).toBe("value");
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(await promise).toBe("value");
//   });
//   test("node:fs/promises", async () => {
//     const fs = require("fs").promises;
//     const s = new AsyncLocalStorage<string>();
//     let v!: string;
//     await s.run("value", async () => {
//       expect(s.getStore()).toBe("value");
//       await fs.readFile(import.meta.path).then(() => {
//         v = s.getStore()!;
//       });
//       expect(s.getStore()).toBe("value");
//     });
//     expect(s.getStore()).toBe(undefined);
//     expect(v).toBe("value");
//   });
//   test("Bun.build plugin", async () => {
//     const s = new AsyncLocalStorage<string>();
//     let a = undefined;
//     await s.run("value", async () => {
//       Bun.build({
//         entrypoints: [import.meta.path],
//         plugins: [
//           {
//             name: "test",
//             setup(build) {
//               a = s.getStore();
//             },
//           },
//         ],
//       });
//     });
//     expect(a).toBe("value");
//   });
// });
