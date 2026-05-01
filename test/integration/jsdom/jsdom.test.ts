import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

describe("jsdom", () => {
  for (const runScripts of ["dangerously", "outside-only", undefined]) {
    test(`runScripts: ${runScripts}`, () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body><h1>Hello World!</h1></body></html>`, {
        url: "https://example.com",
        runScripts,
      });
      expect(dom.window.document.querySelector("h1").textContent).toBe("Hello World!");
    });
  }
});
