//#FILE: test-http-server-options-incoming-message.js
//#SHA1: 5d553fff4a2a29f67836269914e5f33b7e91b64e
//-----------------
"use strict";

/**
 * This test covers http.Server({ IncomingMessage }) option:
 * With IncomingMessage option the server should use
 * the new class for creating req Object instead of the default
 * http.IncomingMessage.
 */
const http = require("http");

class MyIncomingMessage extends http.IncomingMessage {
  getUserAgent() {
    return this.headers["user-agent"] || "unknown";
  }
}

test("http.Server with custom IncomingMessage", done => {
  const server = http.createServer(
    {
      IncomingMessage: MyIncomingMessage,
    },
    (req, res) => {
      expect(req.getUserAgent()).toBe("node-test");
      res.statusCode = 200;
      res.end();
    },
  );

  server.listen(() => {
    const { port } = server.address();

    http.get(
      {
        port,
        headers: {
          "User-Agent": "node-test",
        },
      },
      res => {
        expect(res.statusCode).toBe(200);
        res.on("end", () => {
          server.close();
          done();
        });
        res.resume();
      },
    );
  });
});

//<#END_FILE: test-http-server-options-incoming-message.js
