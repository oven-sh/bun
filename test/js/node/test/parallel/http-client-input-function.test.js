//#FILE: test-http-client-input-function.js
//#SHA1: 2ca0147b992331ea69803031f33076c685bce264
//-----------------
"use strict";

const http = require("http");

test("http.ClientRequest with server response", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("hello world");
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const serverAddress = server.address();

  const responsePromise = new Promise(resolve => {
    const req = new http.ClientRequest(serverAddress, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });

      response.on("end", () => {
        resolve(body);
      });
    });

    req.end();
  });

  const body = await responsePromise;
  expect(body).toBe("hello world");

  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http-client-input-function.js
