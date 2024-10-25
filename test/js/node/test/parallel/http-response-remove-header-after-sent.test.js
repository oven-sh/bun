//#FILE: test-http-response-remove-header-after-sent.js
//#SHA1: df9a9a2f545c88b70d6d33252a1568339ea6f5b3
//-----------------
"use strict";

const http = require("http");

test("remove header after response is sent", done => {
  const server = http.createServer((req, res) => {
    res.removeHeader("header1", 1);
    res.write("abc");
    expect(() => res.removeHeader("header2", 2)).toThrow(
      expect.objectContaining({
        code: "ERR_HTTP_HEADERS_SENT",
        name: "Error",
        message: expect.any(String),
      }),
    );
    res.end();
  });

  server.listen(0, () => {
    http.get({ port: server.address().port }, () => {
      server.close();
      done();
    });
  });
});

//<#END_FILE: test-http-response-remove-header-after-sent.js
