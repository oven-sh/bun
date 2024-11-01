//#FILE: test-http2-compat-serverresponse-end-after-statuses-without-body.js
//#SHA1: c4a4b76e1b04b7e6779f80f7077758dfab0e8b80
//-----------------
"use strict";

const h2 = require("http2");

const { HTTP_STATUS_NO_CONTENT, HTTP_STATUS_RESET_CONTENT, HTTP_STATUS_NOT_MODIFIED } = h2.constants;

const statusWithoutBody = [HTTP_STATUS_NO_CONTENT, HTTP_STATUS_RESET_CONTENT, HTTP_STATUS_NOT_MODIFIED];
const STATUS_CODES_COUNT = statusWithoutBody.length;

describe("HTTP/2 server response end after statuses without body", () => {
  let server;
  let url;

  beforeAll(done => {
    server = h2.createServer((req, res) => {
      res.writeHead(statusWithoutBody.pop());
      res.end();
    });

    server.listen(0, () => {
      url = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  it("should handle end() after sending statuses without body", done => {
    const client = h2.connect(url, () => {
      let responseCount = 0;
      const closeAfterResponse = () => {
        if (STATUS_CODES_COUNT === ++responseCount) {
          client.destroy();
          done();
        }
      };

      for (let i = 0; i < STATUS_CODES_COUNT; i++) {
        const request = client.request();
        request.on("response", closeAfterResponse);
      }
    });
  });
});

//<#END_FILE: test-http2-compat-serverresponse-end-after-statuses-without-body.js
