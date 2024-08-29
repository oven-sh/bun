//#FILE: test-zlib-sync-no-event.js
//#SHA1: 382796f607eb25a85aa067e0dbc3d5103d321def
//-----------------
"use strict";
const zlib = require("zlib");

const message = "Come on, Fhqwhgads.";
const buffer = Buffer.from(message);

test("zlib sync compression and decompression without events", () => {
  const zipper = new zlib.Gzip();
  const closeSpy = jest.fn();
  zipper.on("close", closeSpy);

  const zipped = zipper._processChunk(buffer, zlib.constants.Z_FINISH);

  const unzipper = new zlib.Gunzip();
  const unzipperCloseSpy = jest.fn();
  unzipper.on("close", unzipperCloseSpy);

  const unzipped = unzipper._processChunk(zipped, zlib.constants.Z_FINISH);

  expect(zipped).toEqual(
    // prettier-ignore
    Buffer.from([ 31, 139, 8, 0, 0, 0, 0, 0, 0, osbyte(), 115, 206, 207, 77, 85, 200, 207, 211, 81, 112, 203, 40, 44, 207, 72, 79, 76, 41, 214, 3, 0, 160, 120, 128, 220, 19, 0, 0, 0 ]),
  );
  expect(unzipped.toString()).toEqual(message);

  expect(closeSpy).not.toHaveBeenCalled();
  expect(unzipperCloseSpy).not.toHaveBeenCalled();
});

//<#END_FILE: test-zlib-sync-no-event.js

function osbyte() {
  if (process.platform === "darwin") return 19;
  if (process.platform === "linux") return 3;
  if (process.platform === "win32") return 10;
}
