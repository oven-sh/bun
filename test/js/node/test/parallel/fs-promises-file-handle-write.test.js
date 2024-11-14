//#FILE: test-fs-promises-file-handle-write.js
//#SHA1: 6ca802494e0ce0ee3187b1661322f115cfd7340c
//-----------------
"use strict";

const fs = require("fs");
const { open } = fs.promises;
const path = require("path");
const os = require("os");

const tmpDir = path.join(os.tmpdir(), "test-fs-promises-file-handle-write");

beforeAll(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("validateWrite", async () => {
  const filePathForHandle = path.resolve(tmpDir, "tmp-write.txt");
  const fileHandle = await open(filePathForHandle, "w+");
  const buffer = Buffer.from("Hello world".repeat(100), "utf8");

  await fileHandle.write(buffer, 0, buffer.length);
  const readFileData = fs.readFileSync(filePathForHandle);
  expect(readFileData).toEqual(buffer);

  await fileHandle.close();
});

test("validateEmptyWrite", async () => {
  const filePathForHandle = path.resolve(tmpDir, "tmp-empty-write.txt");
  const fileHandle = await open(filePathForHandle, "w+");
  const buffer = Buffer.from(""); // empty buffer

  await fileHandle.write(buffer, 0, buffer.length);
  const readFileData = fs.readFileSync(filePathForHandle);
  expect(readFileData).toEqual(buffer);

  await fileHandle.close();
});

test("validateNonUint8ArrayWrite", async () => {
  const filePathForHandle = path.resolve(tmpDir, "tmp-data-write.txt");
  const fileHandle = await open(filePathForHandle, "w+");
  const buffer = Buffer.from("Hello world", "utf8").toString("base64");

  await fileHandle.write(buffer, 0, buffer.length);
  const readFileData = fs.readFileSync(filePathForHandle);
  expect(readFileData).toEqual(Buffer.from(buffer, "utf8"));

  await fileHandle.close();
});

test("validateNonStringValuesWrite", async () => {
  const filePathForHandle = path.resolve(tmpDir, "tmp-non-string-write.txt");
  const fileHandle = await open(filePathForHandle, "w+");
  const nonStringValues = [
    123,
    {},
    new Map(),
    null,
    undefined,
    0n,
    () => {},
    Symbol(),
    true,
    new String("notPrimitive"),
    {
      toString() {
        return "amObject";
      },
    },
    { [Symbol.toPrimitive]: hint => "amObject" },
  ];
  for (const nonStringValue of nonStringValues) {
    await expect(fileHandle.write(nonStringValue)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/"buffer"/),
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  }

  await fileHandle.close();
});

//<#END_FILE: test-fs-promises-file-handle-write.js
