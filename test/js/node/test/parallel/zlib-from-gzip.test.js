//#FILE: test-zlib-from-gzip.js
//#SHA1: 44570a611316087d64497151e9ed570aca9060d5
//-----------------
"use strict";

import { tmpdirSync } from "harness";

const assert = require("assert");
const path = require("path");
const zlib = require("zlib");
const fixtures = require("../common/fixtures");
const fs = require("fs");

test("test unzipping a file that was created with a non-node gzip lib, piped in as fast as possible", async () => {
  const x = tmpdirSync();
  const gunzip = zlib.createGunzip();
  const fixture = fixtures.path("person.jpg.gz");
  const unzippedFixture = fixtures.path("person.jpg");
  const outputFile = path.resolve(x, "person.jpg");
  const expected = fs.readFileSync(unzippedFixture);
  const inp = fs.createReadStream(fixture);
  const out = fs.createWriteStream(outputFile);

  inp.pipe(gunzip).pipe(out);

  const { promise, resolve, reject } = Promise.withResolvers();

  out.on("close", () => {
    try {
      const actual = fs.readFileSync(outputFile);
      expect(actual.length).toBe(expected.length);
      expect(actual).toEqual(expected);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  await promise;
});

//<#END_FILE: test-zlib-from-gzip.js
