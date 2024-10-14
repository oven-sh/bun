//#FILE: test-http2-compat-serverresponse-statuscode.js
//#SHA1: 10cb487c1fd9e256f807319b84c426b356be443f
//-----------------
"use strict";

const h2 = require("http2");

let server;
let port;

beforeAll(async () => {
  server = h2.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  port = server.address().port;
});

afterAll(async () => {
  server.close();
});

test("Http2ServerResponse should have a statusCode property", async () => {
  const responsePromise = new Promise(resolve => {
    server.once("request", (request, response) => {
      const expectedDefaultStatusCode = 200;
      const realStatusCodes = {
        continue: 100,
        ok: 200,
        multipleChoices: 300,
        badRequest: 400,
        internalServerError: 500,
      };
      const fakeStatusCodes = {
        tooLow: 99,
        tooHigh: 600,
      };

      expect(response.statusCode).toBe(expectedDefaultStatusCode);

      // Setting the response.statusCode should not throw.
      response.statusCode = realStatusCodes.ok;
      response.statusCode = realStatusCodes.multipleChoices;
      response.statusCode = realStatusCodes.badRequest;
      response.statusCode = realStatusCodes.internalServerError;

      expect(() => {
        response.statusCode = realStatusCodes.continue;
      }).toThrow(
        expect.objectContaining({
          code: "ERR_HTTP2_INFO_STATUS_NOT_ALLOWED",
          name: "RangeError",
        }),
      );

      expect(() => {
        response.statusCode = fakeStatusCodes.tooLow;
      }).toThrow(
        expect.objectContaining({
          code: "ERR_HTTP2_STATUS_INVALID",
          name: "RangeError",
        }),
      );

      expect(() => {
        response.statusCode = fakeStatusCodes.tooHigh;
      }).toThrow(
        expect.objectContaining({
          code: "ERR_HTTP2_STATUS_INVALID",
          name: "RangeError",
        }),
      );

      response.on("finish", resolve);
      response.end();
    });
  });

  const url = `http://localhost:${port}`;
  const client = h2.connect(url);

  const headers = {
    ":path": "/",
    ":method": "GET",
    ":scheme": "http",
    ":authority": `localhost:${port}`,
  };

  const request = client.request(headers);
  request.end();
  await new Promise(resolve => request.resume().on("end", resolve));

  await responsePromise;
  client.close();
});

//<#END_FILE: test-http2-compat-serverresponse-statuscode.js
