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

  // With `runScripts`, `dom.window` is the global object of a node:vm context. The window object owns these names as getters without a setter, and a store to one does not throw in Node.js.
  for (const runScripts of ["dangerously", "outside-only"] as const) {
    test(`runScripts: ${runScripts}: a store to a window property that has no setter does not throw`, () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "https://example.com", runScripts });
      const stores: Record<string, string> = {};
      for (const name of ["localStorage", "sessionStorage", "navigator", "document", "history"]) {
        try {
          dom.window[name] = { replaced: true };
          stores[name] = "no throw";
        } catch (e) {
          stores[name] = (e as Error).name;
        }
      }
      stores.insideTheWindow = dom.window.eval(
        "'use strict'; try { window.localStorage = {}; 'no throw' } catch (e) { e.name }",
      );
      expect(stores).toEqual({
        localStorage: "no throw",
        sessionStorage: "no throw",
        navigator: "no throw",
        document: "no throw",
        history: "no throw",
        insideTheWindow: "no throw",
      });
      expect(typeof dom.window.localStorage.getItem).toBe("function");
    });
  }
});
