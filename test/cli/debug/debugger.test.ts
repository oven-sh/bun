import * as path from "node:path";
import { expect, it, mock } from "bun:test";

it("test parseUrl", () => {
  const modulePath = path.join(import.meta.path, "../../../../src/js/internal/debugger.ts");
  const debuggerModule = require(modulePath);
  mock.module(modulePath, () => ({
    ...debuggerModule,
    randomId: () => "random",
  }));
  const parseUrl = debuggerModule.parseUrl;

  expect(parseUrl("")).toStrictEqual(new URL("ws://localhost:6499/random"));
  expect(parseUrl("9898")).toStrictEqual(new URL("ws://localhost:9898/random"));
  expect(parseUrl("/prefix")).toStrictEqual(new URL("ws://localhost:6499/prefix"));

  expect(parseUrl("localhost")).toStrictEqual(new URL("ws://localhost:6499/random"));
  expect(parseUrl("localhost:9898")).toStrictEqual(new URL("ws://localhost:9898/random"));
  expect(parseUrl("localhost:9898/prefix")).toStrictEqual(new URL("ws://localhost:9898/prefix"));
  expect(parseUrl("localhost:9898/")).toStrictEqual(new URL("ws://localhost:9898/random"));

  expect(parseUrl("0.0.0.0")).toStrictEqual(new URL("ws://0.0.0.0:6499/random"));
  expect(parseUrl("127.0.0.1:9898")).toStrictEqual(new URL("ws://127.0.0.1:9898/random"));
  expect(parseUrl("127.0.0.1:9898/prefix")).toStrictEqual(new URL("ws://127.0.0.1:9898/prefix"));
  expect(parseUrl("127.0.0.1:9898/")).toStrictEqual(new URL("ws://127.0.0.1:9898/random"));

  expect(parseUrl("[::1]")).toStrictEqual(new URL("ws://[::1]:6499/random"));
  expect(parseUrl("[::1]:9898")).toStrictEqual(new URL("ws://[::1]:9898/random"));
  expect(parseUrl("[::1]:9898/prefix")).toStrictEqual(new URL("ws://[::1]:9898/prefix"));
  expect(parseUrl("[::1]:9898/")).toStrictEqual(new URL("ws://[::1]:9898/random"));
});
