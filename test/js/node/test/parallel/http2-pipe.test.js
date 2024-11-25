//#FILE: test-http2-pipe.js
//#SHA1: bb970b612d495580b8c216a1b202037e5eb0721e
//-----------------
"use strict";

import { afterEach, beforeEach, test, expect, describe, mock } from "bun:test";

const http2 = require("http2");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Skip the test if crypto is not available
let hasCrypto;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  hasCrypto = false;
}

const testIfCrypto = hasCrypto ? test : test.skip;

describe("HTTP2 Pipe", () => {
  let server;
  let serverPort;
  let tmpdir;
  const fixturesDir = path.join(__dirname, "..", "fixtures");
  const loc = path.join(fixturesDir, "person-large.jpg");
  let fn;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "http2-test-"));
    fn = path.join(tmpdir, "http2-url-tests.js");
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  testIfCrypto("Piping should work as expected with createWriteStream", done => {
    server = http2.createServer();

    server.on("stream", stream => {
      const dest = stream.pipe(fs.createWriteStream(fn));

      dest.on("finish", () => {
        expect(fs.readFileSync(loc).length).toBe(fs.readFileSync(fn).length);
      });
      stream.respond();
      stream.end();
    });

    server.listen(0, () => {
      serverPort = server.address().port;
      const client = http2.connect(`http://localhost:${serverPort}`);

      const req = client.request({ ":method": "POST" });

      const responseHandler = mock(() => {});
      req.on("response", responseHandler);
      req.resume();

      req.on("close", () => {
        expect(responseHandler).toHaveBeenCalled();
        server.close();
        client.close();
        done();
      });

      const str = fs.createReadStream(loc);
      const strEndHandler = mock(() => {});
      str.on("end", strEndHandler);
      str.pipe(req);

      req.on("finish", () => {
        expect(strEndHandler).toHaveBeenCalled();
      });
    });
  });
});

//<#END_FILE: test-http2-pipe.js
