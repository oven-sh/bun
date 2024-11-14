//#FILE: test-http-server-options-server-response.js
//#SHA1: ae3128a67e671596c2470bb973747640620b807a
//-----------------
"use strict";

/**
 * This test covers http.Server({ ServerResponse }) option:
 * With ServerResponse option the server should use
 * the new class for creating res Object instead of the default
 * http.ServerResponse.
 */
const http = require("http");

class MyServerResponse extends http.ServerResponse {
  status(code) {
    return this.writeHead(code, { "Content-Type": "text/plain" });
  }
}

test("http.Server with custom ServerResponse", done => {
  const server = http.Server(
    {
      ServerResponse: MyServerResponse,
    },
    jest.fn((req, res) => {
      res.status(200);
      res.end();
    }),
  );

  server.listen(() => {
    const port = server.address().port;

    http.get({ port }, res => {
      expect(res.statusCode).toBe(200);
      res.on("end", () => {
        server.close();
        done();
      });
      res.resume();
    });
  });

  server.on("close", () => {
    expect(server.listeners("request")[0]).toHaveBeenCalledTimes(1);
  });
});

//<#END_FILE: test-http-server-options-server-response.js
