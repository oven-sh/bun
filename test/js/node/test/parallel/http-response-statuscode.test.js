//#FILE: test-http-response-statuscode.js
//#SHA1: 5cfb9f0116592b811498c925c45a60568b206c14
//-----------------
"use strict";

const http = require("http");

const MAX_REQUESTS = 13;
let reqNum = 0;

function test(res, header, code) {
  expect(() => {
    res.writeHead(header);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_HTTP_INVALID_STATUS_CODE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
}

describe("HTTP Response Status Code", () => {
  let server;

  beforeAll(() => {
    return new Promise(resolve => {
      server = http.Server((req, res) => {
        switch (reqNum) {
          case 0:
            test(res, -1, "-1");
            break;
          case 1:
            test(res, Infinity, "Infinity");
            break;
          case 2:
            test(res, NaN, "NaN");
            break;
          case 3:
            test(res, {}, "{}");
            break;
          case 4:
            test(res, 99, "99");
            break;
          case 5:
            test(res, 1000, "1000");
            break;
          case 6:
            test(res, "1000", "1000");
            break;
          case 7:
            test(res, null, "null");
            break;
          case 8:
            test(res, true, "true");
            break;
          case 9:
            test(res, [], "[]");
            break;
          case 10:
            test(res, "this is not valid", "this is not valid");
            break;
          case 11:
            test(res, "404 this is not valid either", "404 this is not valid either");
            break;
          case 12:
            expect(() => {
              res.writeHead();
            }).toThrow(
              expect.objectContaining({
                code: "ERR_HTTP_INVALID_STATUS_CODE",
                name: "RangeError",
                message: expect.any(String),
              }),
            );
            server.close();
            break;
          default:
            throw new Error("Unexpected request");
        }
        res.statusCode = 200;
        res.end();
      });

      server.listen(0, () => {
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise(resolve => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("should handle invalid status codes", async () => {
    const makeRequest = () => {
      return new Promise(resolve => {
        http.get(
          {
            port: server.address().port,
          },
          res => {
            expect(res.statusCode).toBe(200);
            res.on("end", () => {
              reqNum++;
              resolve();
            });
            res.resume();
          },
        );
      });
    };

    for (let i = 0; i < MAX_REQUESTS; i++) {
      await makeRequest();
    }
  });
});

//<#END_FILE: test-http-response-statuscode.js
