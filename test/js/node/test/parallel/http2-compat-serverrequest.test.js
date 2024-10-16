//#FILE: test-http2-compat-serverrequest.js
//#SHA1: f661c6c9249c0cdc770439f7498943fc5edbf86b
//-----------------
"use strict";

const h2 = require("http2");
const net = require("net");

let server;
let port;

beforeAll(done => {
  server = h2.createServer();
  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll(done => {
  server.close(done);
});

// today we deatch the socket earlier
test.todo("Http2ServerRequest should expose convenience properties", done => {
  expect.assertions(7);

  server.once("request", (request, response) => {
    const expected = {
      version: "2.0",
      httpVersionMajor: 2,
      httpVersionMinor: 0,
    };

    expect(request.httpVersion).toBe(expected.version);
    expect(request.httpVersionMajor).toBe(expected.httpVersionMajor);
    expect(request.httpVersionMinor).toBe(expected.httpVersionMinor);

    expect(request.socket).toBeInstanceOf(net.Socket);
    expect(request.connection).toBeInstanceOf(net.Socket);
    expect(request.socket).toBe(request.connection);

    response.on("finish", () => {
      process.nextTick(() => {
        expect(request.socket).toBeTruthy();
        done();
      });
    });
    response.end();
  });

  const url = `http://localhost:${port}`;
  const client = h2.connect(url, () => {
    const headers = {
      ":path": "/foobar",
      ":method": "GET",
      ":scheme": "http",
      ":authority": `localhost:${port}`,
    };
    const request = client.request(headers);
    request.on("end", () => {
      client.close();
    });
    request.end();
    request.resume();
  });
});

//<#END_FILE: test-http2-compat-serverrequest.js
