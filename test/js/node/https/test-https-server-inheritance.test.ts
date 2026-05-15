import { test, expect, describe } from "bun:test";
import https from "node:https";
import tls from "node:tls";

describe("https.Server", () => {
  test("should be an instance of tls.Server", () => {
    const server = https.createServer(() => {});
    expect(server).toBeInstanceOf(tls.Server);
  });

  test("should have addContext method from tls.Server", () => {
    const server = https.createServer(() => {});
    expect(typeof server.addContext).toBe("function");
  });

  test("should have setSecureContext method from tls.Server", () => {
    const server = https.createServer(() => {});
    expect(typeof server.setSecureContext).toBe("function");
  });

  test("Server constructor should return instance when called without new", () => {
    const server = https.Server({}, () => {});
    expect(server).toBeInstanceOf(https.Server);
    expect(server).toBeInstanceOf(tls.Server);
  });

  test("createServer should return https.Server instance", () => {
    const server = https.createServer(() => {});
    expect(server).toBeInstanceOf(https.Server);
  });

  test("createServer with options should work", () => {
    const server = https.createServer({ key: "test", cert: "test" }, () => {});
    expect(server).toBeInstanceOf(https.Server);
    expect(typeof server.addContext).toBe("function");
  });
});
