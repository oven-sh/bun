//#FILE: test-dns-resolve-promises.js
//#SHA1: ca56d4fe55a765a3e9db340661c96d8b1fd7a7a9
//-----------------
"use strict";

const dns = require("dns");

test("DNS resolve promises error handling", async () => {
  // Mock the dns.promises.resolve function to simulate an error
  dns.promises.resolve = jest.fn().mockRejectedValue({
    code: "EPERM",
    syscall: "queryA",
    hostname: "example.org",
  });

  await expect(dns.promises.resolve("example.org")).rejects.toMatchObject({
    code: "EPERM",
    syscall: "queryA",
    hostname: "example.org",
  });

  expect(dns.promises.resolve).toHaveBeenCalledWith("example.org");
});

//<#END_FILE: test-dns-resolve-promises.js
