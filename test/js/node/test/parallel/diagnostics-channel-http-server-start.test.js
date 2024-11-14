//#FILE: test-diagnostics-channel-http-server-start.js
//#SHA1: 5540b17246152983b832ddafa0be55502ee83a23
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const dc = require("diagnostics_channel");
const http = require("http");

const als = new AsyncLocalStorage();
let context;

describe("diagnostics_channel http server start", () => {
  let server;
  let request;
  let response;

  beforeAll(() => {
    // Bind requests to an AsyncLocalStorage context
    dc.subscribe("http.server.request.start", message => {
      als.enterWith(message);
      context = message;
    });

    // When the request ends, verify the context has been maintained
    // and that the messages contain the expected data
    dc.subscribe("http.server.response.finish", message => {
      const data = {
        request,
        response,
        server,
        socket: request.socket,
      };

      // Context is maintained
      compare(als.getStore(), context);

      compare(context, data);
      compare(message, data);
    });

    server = http.createServer((req, res) => {
      request = req;
      response = res;

      setTimeout(() => {
        res.end("done");
      }, 1);
    });
  });

  afterAll(() => {
    server.close();
  });

  it("should maintain context and contain expected data", done => {
    server.listen(() => {
      const { port } = server.address();
      http.get(`http://localhost:${port}`, res => {
        res.resume();
        res.on("end", () => {
          done();
        });
      });
    });
  });
});

function compare(a, b) {
  expect(a.request).toBe(b.request);
  expect(a.response).toBe(b.response);
  expect(a.socket).toBe(b.socket);
  expect(a.server).toBe(b.server);
}

//<#END_FILE: test-diagnostics-channel-http-server-start.js
