import { expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { tempDir } from "harness";
test("fs.promises.writeFile async iterator", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const path = dir + "/file2.txt";

  const stream = async function* () {
    yield "1 ";
    yield "Hello, ";
    yield "world!";
  };

  await writeFile(path, stream());
  expect(await Bun.file(path).text()).toBe("1 Hello, world!");

  const bufStream = async function* () {
    yield Buffer.from("2 ");
    yield Buffer.from("Hello, ");
    yield Buffer.from("world!");
  };

  await writeFile(path, bufStream());

  expect(await Bun.file(path).text()).toBe("2 Hello, world!");
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const symbolStream = async function* () {
    yield Symbol("lolwhat");
  };

  expect(() => writeFile(dir + "/file2.txt", symbolStream() as any)).toThrow();
  expect(() =>
    writeFile(
      dir + "/file3.txt",
      (async function* () {
        yield "once";
        throw new Error("good");
      })(),
    ),
  ).toThrow("good");
  const fn = {
    [Symbol.asyncIterator]: mock(() => {}),
  };
  expect(() => writeFile(String(dir), fn as any)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});

// Node: `const flag = options.flag || 'w'`.
test("fs.promises.writeFile with iterable data takes a falsy flag as the default flag", async () => {
  await using dir = tempDir("fs-promises-writeFile-falsy-flag", {});
  const path = dir + "/file.txt";
  const falsy: [string, any][] = [
    ["false", false],
    ["zero", 0],
    ["negative zero", -0],
    ["NaN", NaN],
    ["0n", 0n],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ];
  const sources: [string, () => Iterable<string> | AsyncIterable<string>][] = [
    ["iterable", () => ["n", "e", "w"]],
    [
      "async iterable",
      async function* () {
        yield "n";
        yield "e";
        yield "w";
      },
    ],
  ];

  const results: Record<string, string> = {};
  const expected: Record<string, string> = {};
  for (const [kind, data] of sources) {
    for (const [label, flag] of falsy) {
      // Longer than "new": the default flag truncates.
      await Bun.write(path, "old content");
      const row = `${kind}, flag ${label}`;
      results[row] = await writeFile(path, data(), { flag }).then(
        () => readFileSync(path, "utf8"),
        e => `${e.code}, the file holds ${readFileSync(path, "utf8")}`,
      );
      expected[row] = "new";
    }
  }
  expect(results).toEqual(expected);
});
