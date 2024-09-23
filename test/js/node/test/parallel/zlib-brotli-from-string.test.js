//#FILE: test-zlib-brotli-from-string.js
//#SHA1: bb4656c195e75f9d49e2bad9e7b1130f571fa68b
//-----------------
"use strict";
// Test compressing and uncompressing a string with brotli

const zlib = require("zlib");

const inputString =
  "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
  "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
  "convallis lacus, in commodo libero metus eu nisi. Nullam" +
  " commodo, neque nec porta placerat, nisi est fermentum a" +
  "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
  "n non diam orci. Proin quis elit turpis. Suspendisse non" +
  " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
  "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
  "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ";
const compressedString =
  "G/gBQBwHdky2aHV5KK9Snf05//1pPdmNw/7232fnIm1IB" +
  "K1AA8RsN8OB8Nb7Lpgk3UWWUlzQXZyHQeBBbXMTQXC1j7" +
  "wg3LJs9LqOGHRH2bj/a2iCTLLx8hBOyTqgoVuD1e+Qqdn" +
  "f1rkUNyrWq6LtOhWgxP3QUwdhKGdZm3rJWaDDBV7+pDk1" +
  "MIkrmjp4ma2xVi5MsgJScA3tP1I7mXeby6MELozrwoBQD" +
  "mVTnEAicZNj4lkGqntJe2qSnGyeMmcFgraK94vCg/4iLu" +
  "Tw5RhKhnVY++dZ6niUBmRqIutsjf5TzwF5iAg8a9UkjF5" +
  "2eZ0tB2vo6v8SqVfNMkBmmhxr0NT9LkYF69aEjlYzj7IE" +
  "KmEUQf1HBogRYhFIt4ymRNEgHAIzOyNEsQM=";

test("brotli compress and decompress string", async () => {
  const compressCallback = jest.fn();
  const decompressCallback = jest.fn();

  await new Promise(resolve => {
    zlib.brotliCompress(inputString, (err, buffer) => {
      compressCallback();
      expect(inputString.length).toBeGreaterThan(buffer.length);

      zlib.brotliDecompress(buffer, (err, buffer) => {
        decompressCallback();
        expect(buffer.toString()).toBe(inputString);
        resolve();
      });
    });
  });

  expect(compressCallback).toHaveBeenCalledTimes(1);
  expect(decompressCallback).toHaveBeenCalledTimes(1);
});

test("brotli decompress base64 string", async () => {
  const decompressCallback = jest.fn();

  const buffer = Buffer.from(compressedString, "base64");
  await new Promise(resolve => {
    zlib.brotliDecompress(buffer, (err, buffer) => {
      decompressCallback();
      expect(buffer.toString()).toBe(inputString);
      resolve();
    });
  });

  expect(decompressCallback).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-zlib-brotli-from-string.js
