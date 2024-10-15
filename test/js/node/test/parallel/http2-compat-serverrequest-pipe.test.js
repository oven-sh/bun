//#FILE: test-http2-compat-serverrequest-pipe.js
//#SHA1: c4254ac88df3334dccc8adb4b60856193a6e644e
//-----------------
"use strict";

const http2 = require("http2");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isWindows } = require("harness");

const fixtures = path.join(__dirname, "..", "fixtures");
const tmpdir = os.tmpdir();

let server;
let client;
let port;

beforeAll(async () => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }

  await fs.promises.mkdir(tmpdir, { recursive: true });
});

afterAll(async () => {
  if (server) server.close();
  if (client) client.close();
});

test.todoIf(isWindows)("HTTP/2 server request pipe", done => {
  const loc = path.join(fixtures, "person-large.jpg");
  const fn = path.join(tmpdir, "http2-url-tests.js");

  server = http2.createServer();

  server.on("request", (req, res) => {
    const dest = req.pipe(fs.createWriteStream(fn));
    dest.on("finish", () => {
      expect(req.complete).toBe(true);
      expect(fs.readFileSync(loc).length).toBe(fs.readFileSync(fn).length);
      fs.unlinkSync(fn);
      res.end();
    });
  });

  server.listen(0, () => {
    port = server.address().port;
    client = http2.connect(`http://localhost:${port}`);

    let remaining = 2;
    function maybeClose() {
      if (--remaining === 0) {
        done();
      }
    }

    const req = client.request({ ":method": "POST" });
    req.on("response", () => {});
    req.resume();
    req.on("end", maybeClose);
    const str = fs.createReadStream(loc);
    str.on("end", maybeClose);
    str.pipe(req);
  });
});

//<#END_FILE: test-http2-compat-serverrequest-pipe.js
