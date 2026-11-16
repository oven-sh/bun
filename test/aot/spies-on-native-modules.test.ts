import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// node:buffer, node:process, node:util/types and node:string_decoder are written in C++. Compiled, a spy on their namespace was refused:
// "Cannot spy on 'cwd' of "node:process" because the build didn't see a test spy on it".
const uses = `
  import { isUtf8 } from "node:buffer";
  import * as buffer from "node:buffer";
  import bufferDefault from "node:buffer";
  import { cwd } from "node:process";
  import { isDate } from "node:util/types";
  import { StringDecoder } from "node:string_decoder";
  const bytes = Buffer.from("a");
  export const named = () => isUtf8(bytes);
  export const all = () =>
    [isUtf8(bytes), buffer.isUtf8(bytes), bufferDefault.isUtf8(bytes), require("node:buffer").isUtf8(bytes)].join() +
    " " + typeof cwd() + " " + isDate(new Date()) + " " + new StringDecoder("utf8").encoding;
`;

const head = `
  import { mock, spyOn, test, vi } from "bun:test";
  import * as buffer from "node:buffer";
  import * as process from "node:process";
  import * as types from "node:util/types";
  import * as decoder from "node:string_decoder";
  import { all, named } from "./uses";
  const tried = action => {
    try {
      return action();
    } catch (error) {
      console.log("SEEN " + error.message);
    }
  };
`;

const files = {
  "uses.js": uses,
  "a-literal.test.js": `${head}
    test("names spelled out", () => {
      console.log("SEEN before " + all());
      const spies = [
        tried(() => spyOn(buffer, "isUtf8").mockReturnValue(5)),
        tried(() => vi.spyOn(process, "cwd").mockReturnValue(7)),
        tried(() => spyOn(types, "isDate").mockReturnValue(9)),
        tried(() => spyOn(decoder, "StringDecoder").mockImplementation(function () { this.encoding = "spied"; })),
      ];
      console.log("SEEN spied " + all() + " | " + spies.map(spy => spy?.mock.calls.length));
      mock.restore();
      console.log("SEEN restored " + all());
    });`,
  "b-computed.test.js": `${head}
    test("names put together", () => {
      for (const part of ["is", "Utf8"].slice(1)) tried(() => spyOn(buffer, "is" + part).mockReturnValue(1));
      console.log("SEEN computed " + all());
      mock.restore();
      console.log("SEEN computed, restored " + all());
    });`,
  "c-imported.test.js": `
    import { spyOn, test } from "bun:test";
    import { all, named } from "./uses";
    test("a namespace that import() returns", async () => {
      const process = await import("node:process");
      const copy = process;
      const spy = spyOn(process, "cwd").mockReturnValue(7);
      console.log("SEEN imported " + all() + " | " + spy.mock.calls.length);
      spy.mockRestore();
      const again = spyOn(copy, "cwd").mockReturnValue(7);
      console.log("SEEN copied " + all() + " | " + again.mock.calls.length);
      again.mockRestore();
    });`,
  "d-without.test.js": `
    import { test } from "bun:test";
    import { all, named } from "./uses";
    test("without a spy", () => console.log("SEEN without " + all() + " " + named()));`,
};

async function seenIn(directory: string, ...flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("a spy reaches the exports of a module written in C++", async () => {
  using directory = tempDir("spies-on-native-modules", files);
  const plain = await seenIn(String(directory));
  expect(plain.seen).toContain("SEEN spied 5,5,true,true number 9 spied | 2,1,1,1");
  expect(plain.seen).toHaveLength(8);
  expect(await seenIn(String(directory), "--aot")).toEqual(plain);
}, 240_000);
