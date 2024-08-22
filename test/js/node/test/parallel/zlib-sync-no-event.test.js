//#FILE: test-zlib-sync-no-event.js
//#SHA1: 382796f607eb25a85aa067e0dbc3d5103d321def
//-----------------
"use strict";
const zlib = require("zlib");

const message = "Come on, Fhqwhgads.";
const buffer = Buffer.from(message);

test("Gzip and Gunzip synchronously without emitting events", () => {
  const zipper = new zlib.Gzip();
  const closeSpy = jest.fn();
  zipper.on("close", closeSpy);

  const zipped = zipper._processChunk(buffer, zlib.constants.Z_FINISH);

  const unzipper = new zlib.Gunzip();
  const unzipperCloseSpy = jest.fn();
  unzipper.on("close", unzipperCloseSpy);

  const unzipped = unzipper._processChunk(zipped, zlib.constants.Z_FINISH);

  expect(zipped.toString()).not.toBe(message);
  expect(unzipped.toString()).toBe(message);

  expect(closeSpy).not.toHaveBeenCalled();
  expect(unzipperCloseSpy).not.toHaveBeenCalled();
});
