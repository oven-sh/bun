import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";

// Trimming replaces the native getters and setters of a removed feature. Where nothing is trimmed, under `bun run` and in
// an executable built without --trim, every native accessor answers as it always has: read, stored, read again at one
// place, reached through its property descriptor, inherited, and called on the wrong receiver.
const program = `
  const url = new URL("http://example.com/a?b#c");
  const href = Object.getOwnPropertyDescriptor(URL.prototype, "href")!;
  const paths: string[] = [];
  for (let i = 0; i < 3; i++) paths.push(url.pathname);
  url.hash = "#d";
  href.set!.call(url, href.get!.call(url) + "e");
  class Derived extends URL {}
  let wrongReceiver = "";
  try {
    href.get!.call({});
  } catch (error) {
    wrongReceiver = (error as Error).name;
  }
  console.log(JSON.stringify([paths, url.hash, url.href, new Derived("http://example.com/f").pathname, URL.prototype.constructor === URL, wrongReceiver]));
`;
const expected = {
  stdout: '[["/a","/a","/a"],"#de","http://example.com/a?b#de","/f",true,"TypeError"]\n',
  stderr: "",
  exitCode: 0,
};

test("native accessors under bun run", async () => {
  using dir = tempDir("compile-trim-native-accessors", { "program.ts": program });
  expect(await run([bunExe(), "run", "program.ts"], String(dir))).toEqual(expected);
});

test("native accessors in an executable built without --trim", async () => {
  using dir = tempDir("compile-trim-native-accessors", { "program.ts": program });
  const built = await run([bunExe(), "build", "--compile", "program.ts", "--outfile", "program"], String(dir));
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringContaining("error:"),
    exitCode: 0,
  });
  expect(await run([join(String(dir), "program")], String(dir))).toEqual(expected);
});
