//#FILE: test-dgram-custom-lookup.js
//#SHA1: 28c106bfe2e9538e86d65a4aa22ef41ab398499c
//-----------------
"use strict";

const dgram = require("dgram");
const dns = require("dns");

test("Verify that the provided lookup function is called", () => {
  const lookup = jest.fn((host, family, callback) => {
    dns.lookup(host, family, callback);
  });

  const socket = dgram.createSocket({ type: "udp4", lookup });

  return new Promise(resolve => {
    socket.bind(() => {
      expect(lookup).toHaveBeenCalled();
      socket.close();
      resolve();
    });
  });
});

test("Verify that lookup defaults to dns.lookup()", () => {
  const originalLookup = dns.lookup;
  const mockLookup = jest.fn((host, family, callback) => {
    dns.lookup = originalLookup;
    originalLookup(host, family, callback);
  });

  dns.lookup = mockLookup;

  const socket = dgram.createSocket({ type: "udp4" });

  return new Promise(resolve => {
    socket.bind(() => {
      expect(mockLookup).toHaveBeenCalled();
      socket.close();
      resolve();
    });
  });
});

test("Verify that non-functions throw", () => {
  const invalidValues = [null, true, false, 0, 1, NaN, "", "foo", {}, Symbol()];

  invalidValues.forEach(value => {
    expect(() => {
      dgram.createSocket({ type: "udp4", lookup: value });
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining('The "lookup" argument must be of type function'),
      }),
    );
  });
});

//<#END_FILE: test-dgram-custom-lookup.js
