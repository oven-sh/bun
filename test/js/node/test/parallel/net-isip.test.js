//#FILE: test-net-isip.js
//#SHA1: 5fb15ec330f4e7489c3e7eb2a74547c44aa5a4dc
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const net = require("net");

test("net.isIP", () => {
  expect(net.isIP("127.0.0.1")).toBe(4);
  expect(net.isIP("x127.0.0.1")).toBe(0);
  expect(net.isIP("example.com")).toBe(0);
  expect(net.isIP("0000:0000:0000:0000:0000:0000:0000:0000")).toBe(6);
  expect(net.isIP("0000:0000:0000:0000:0000:0000:0000:0000::0000")).toBe(0);
  expect(net.isIP("1050:0:0:0:5:600:300c:326b")).toBe(6);
  expect(net.isIP("2001:252:0:1::2008:6")).toBe(6);
  expect(net.isIP("2001:dead:beef:1::2008:6")).toBe(6);
  expect(net.isIP("2001::")).toBe(6);
  expect(net.isIP("2001:dead::")).toBe(6);
  expect(net.isIP("2001:dead:beef::")).toBe(6);
  expect(net.isIP("2001:dead:beef:1::")).toBe(6);
  expect(net.isIP("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(6);
  expect(net.isIP(":2001:252:0:1::2008:6:")).toBe(0);
  expect(net.isIP(":2001:252:0:1::2008:6")).toBe(0);
  expect(net.isIP("2001:252:0:1::2008:6:")).toBe(0);
  expect(net.isIP("2001:252::1::2008:6")).toBe(0);
  expect(net.isIP("::2001:252:1:2008:6")).toBe(6);
  expect(net.isIP("::2001:252:1:1.1.1.1")).toBe(6);
  expect(net.isIP("::2001:252:1:255.255.255.255")).toBe(6);
  expect(net.isIP("::2001:252:1:255.255.255.255.76")).toBe(0);
  expect(net.isIP("fe80::2008%eth0")).toBe(6);
  expect(net.isIP("fe80::2008%eth0.0")).toBe(6);
  expect(net.isIP("fe80::2008%eth0@1")).toBe(0);
  expect(net.isIP("::anything")).toBe(0);
  expect(net.isIP("::1")).toBe(6);
  expect(net.isIP("::")).toBe(6);
  expect(net.isIP("0000:0000:0000:0000:0000:0000:12345:0000")).toBe(0);
  expect(net.isIP("0")).toBe(0);
  expect(net.isIP()).toBe(0);
  expect(net.isIP("")).toBe(0);
  expect(net.isIP(null)).toBe(0);
  expect(net.isIP(123)).toBe(0);
  expect(net.isIP(true)).toBe(0);
  expect(net.isIP({})).toBe(0);
  expect(net.isIP({ toString: () => "::2001:252:1:255.255.255.255" })).toBe(6);
  expect(net.isIP({ toString: () => "127.0.0.1" })).toBe(4);
  expect(net.isIP({ toString: () => "bla" })).toBe(0);
});

test("net.isIPv4", () => {
  expect(net.isIPv4("127.0.0.1")).toBe(true);
  expect(net.isIPv4("example.com")).toBe(false);
  expect(net.isIPv4("2001:252:0:1::2008:6")).toBe(false);
  expect(net.isIPv4()).toBe(false);
  expect(net.isIPv4("")).toBe(false);
  expect(net.isIPv4(null)).toBe(false);
  expect(net.isIPv4(123)).toBe(false);
  expect(net.isIPv4(true)).toBe(false);
  expect(net.isIPv4({})).toBe(false);
  expect(
    net.isIPv4({
      toString: () => "::2001:252:1:255.255.255.255",
    }),
  ).toBe(false);
  expect(net.isIPv4({ toString: () => "127.0.0.1" })).toBe(true);
  expect(net.isIPv4({ toString: () => "bla" })).toBe(false);
});

test("net.isIPv6", () => {
  expect(net.isIPv6("127.0.0.1")).toBe(false);
  expect(net.isIPv6("example.com")).toBe(false);
  expect(net.isIPv6("2001:252:0:1::2008:6")).toBe(true);
  expect(net.isIPv6()).toBe(false);
  expect(net.isIPv6("")).toBe(false);
  expect(net.isIPv6(null)).toBe(false);
  expect(net.isIPv6(123)).toBe(false);
  expect(net.isIPv6(true)).toBe(false);
  expect(net.isIPv6({})).toBe(false);
  expect(
    net.isIPv6({
      toString: () => "::2001:252:1:255.255.255.255",
    }),
  ).toBe(true);
  expect(net.isIPv6({ toString: () => "127.0.0.1" })).toBe(false);
  expect(net.isIPv6({ toString: () => "bla" })).toBe(false);
});

//<#END_FILE: test-net-isip.js
