//#FILE: test-stream-preprocess.js
//#SHA1: 4061428f95671f257c4a57a92d77c0dc63a1394a
//-----------------
"use strict";

const fs = require("fs");
const rl = require("readline");
const fixtures = require("../common/fixtures");

const BOM = "\uFEFF";

// Get the data using a non-stream way to compare with the streamed data.
const modelData = fixtures.readSync("file-to-read-without-bom.txt", "utf8");
const modelDataFirstCharacter = modelData[0];

// Detect the number of forthcoming 'line' events for mustCall() 'expected' arg.
const lineCount = modelData.match(/\n/g).length;

test("Ensure both without-bom and with-bom test files are textwise equal", () => {
  expect(fixtures.readSync("file-to-read-with-bom.txt", "utf8")).toBe(`${BOM}${modelData}`);
});

test("An unjustified BOM stripping with a non-BOM character unshifted to a stream", done => {
  const inputWithoutBOM = fs.createReadStream(fixtures.path("file-to-read-without-bom.txt"), "utf8");

  inputWithoutBOM.once("readable", () => {
    const maybeBOM = inputWithoutBOM.read(1);
    expect(maybeBOM).toBe(modelDataFirstCharacter);
    expect(maybeBOM).not.toBe(BOM);

    inputWithoutBOM.unshift(maybeBOM);

    let streamedData = "";
    rl.createInterface({
      input: inputWithoutBOM,
    })
      .on("line", line => {
        streamedData += `${line}\n`;
      })
      .on("close", () => {
        expect(streamedData).toBe(modelData);
        done();
      });
  });
});

test("A justified BOM stripping", done => {
  const inputWithBOM = fs.createReadStream(fixtures.path("file-to-read-with-bom.txt"), "utf8");

  inputWithBOM.once("readable", () => {
    const maybeBOM = inputWithBOM.read(1);
    expect(maybeBOM).toBe(BOM);

    let streamedData = "";
    rl.createInterface({
      input: inputWithBOM,
    })
      .on("line", line => {
        streamedData += `${line}\n`;
      })
      .on("close", () => {
        expect(streamedData).toBe(modelData);
        done();
      });
  });
});

//<#END_FILE: test-stream-preprocess.js
