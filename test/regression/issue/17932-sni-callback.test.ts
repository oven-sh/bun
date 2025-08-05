// Regression test for https://github.com/oven-sh/bun/issues/17932
// Tests SNI callback functionality

import { test, expect } from "bun:test";
import { createServer } from "tls";

test("SNICallback should be accepted as a function option", () => {
  let callbackCalled = false;
  let receivedHostname: string | null = null;

  const server = createServer({
    SNICallback: (hostname: string, callback: (err: Error | null, ctx: any) => void) => {
      callbackCalled = true;
      receivedHostname = hostname;
      callback(null, null);
    },
  });

  expect(server.SNICallback).toBeDefined();
  expect(typeof server.SNICallback).toBe("function");

  server.close();
});

test("SNICallback should throw TypeError for non-function values", () => {
  expect(() => {
    createServer({
      SNICallback: "not-a-function" as any,
    });
  }).toThrow("The \"options.SNICallback\" property must be of type function");

  expect(() => {
    createServer({
      SNICallback: 123 as any,
    });
  }).toThrow("The \"options.SNICallback\" property must be of type function");

  expect(() => {
    createServer({
      SNICallback: {} as any,
    });
  }).toThrow("The \"options.SNICallback\" property must be of type function");
});

test("SNICallback should be undefined by default", () => {
  const server = createServer({});
  expect(server.SNICallback).toBeUndefined();
  server.close();
});

test("SNICallback should work with setSecureContext", () => {
  const server = createServer({});
  
  expect(server.SNICallback).toBeUndefined();
  
  server.setSecureContext({
    SNICallback: (hostname: string, callback: (err: Error | null, ctx: any) => void) => {
      callback(null, null);
    },
  });
  
  expect(server.SNICallback).toBeDefined();
  expect(typeof server.SNICallback).toBe("function");
  
  server.close();
});

test("setSecureContext should throw TypeError for invalid SNICallback", () => {
  const server = createServer({});
  
  expect(() => {
    server.setSecureContext({
      SNICallback: "invalid" as any,
    });
  }).toThrow("The \"options.SNICallback\" property must be of type function");
  
  server.close();
});