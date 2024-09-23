//#FILE: test-http-client-defaults.js
//#SHA1: 7209a7752de52cc378c3b29eda88c82d71e6839d
//-----------------
"use strict";

const http = require("http");

describe("ClientRequest defaults", () => {
  test("default path and method", () => {
    const req = new http.ClientRequest({ createConnection: () => {} });
    expect(req.path).toBe("/");
    expect(req.method).toBe("GET");
  });

  test("empty method defaults to GET", () => {
    const req = new http.ClientRequest({ method: "", createConnection: () => {} });
    expect(req.path).toBe("/");
    expect(req.method).toBe("GET");
  });

  test("empty path defaults to /", () => {
    const req = new http.ClientRequest({ path: "", createConnection: () => {} });
    expect(req.path).toBe("/");
    expect(req.method).toBe("GET");
  });
});

//<#END_FILE: test-http-client-defaults.js
