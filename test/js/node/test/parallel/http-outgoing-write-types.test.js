//#FILE: test-http-outgoing-write-types.js
//#SHA1: bdeac2ab8008bea1c7e0b22f8744176dea0410e2
//-----------------
"use strict";

const http = require("http");

test("HTTP outgoing write types", async () => {
  const httpServer = http.createServer((req, res) => {
    httpServer.close();

    expect(() => {
      res.write(["Throws."]);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );

    // should not throw
    expect(() => res.write("1a2b3c")).not.toThrow();

    // should not throw
    expect(() => res.write(new Uint8Array(1024))).not.toThrow();

    // should not throw
    expect(() => res.write(Buffer.from("1".repeat(1024)))).not.toThrow();

    res.end();
  });

  await new Promise(resolve => {
    httpServer.listen(0, () => {
      http.get({ port: httpServer.address().port }, resolve);
    });
  });
});

//<#END_FILE: test-http-outgoing-write-types.js
