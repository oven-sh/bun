//#FILE: test-http-set-header-chain.js
//#SHA1: e009f5ffdce12a659bd2d3402449cd0095d79aa2
//-----------------
"use strict";

const http = require("http");

const expected = {
  __proto__: null,
  testheader1: "foo",
  testheader2: "bar",
  testheader3: "xyz",
};

test("HTTP setHeader chaining", async () => {
  const server = http.createServer((req, res) => {
    let retval = res.setHeader("testheader1", "foo");

    // Test that the setHeader returns the same response object.
    expect(retval).toBe(res);

    retval = res.setHeader("testheader2", "bar").setHeader("testheader3", "xyz");
    // Test that chaining works for setHeader.
    expect(res.getHeaders()).toEqual(expected);
    res.end("ok");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get({ port: server.address().port }, res => {
        res.on("data", () => {});
        res.on("end", () => {
          server.close(resolve);
        });
      });
    });
  });
});

//<#END_FILE: test-http-set-header-chain.js
