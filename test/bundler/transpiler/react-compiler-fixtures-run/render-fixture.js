// render-fixture.js <directory> <names.json>: renders the `FIXTURE_ENTRYPOINT` of each built fixture into <directory>.json.
import React, { at, nextRender, render, unmount } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [directory, names] = process.argv.slice(2);
// The compiler moves functions out and renames them.
Function.prototype.toString = () => "[function]";
// Some fixtures use React or a hook without importing it.
globalThis.React = React;
for (const [name, value] of Object.entries(React)) if (name.startsWith("use")) globalThis[name] = value;
console.log = console.warn = console.error = () => {};

const results = {};
for (const name of JSON.parse(readFileSync(names, "utf8"))) {
  let entry;
  try {
    entry = (await import(pathToFileURL(join(directory, name + ".js")).href)).FIXTURE_ENTRYPOINT;
  } catch (error) {
    results[name] = ["does not load", error?.name];
    continue;
  }
  if (typeof entry?.fn !== "function") {
    results[name] = ["has no entry point"];
    continue;
  }
  unmount();
  // Twice with the same parameters: the second render goes through the memo cache.
  results[name] = (entry.sequentialRenders ?? [entry.params ?? [], entry.params ?? []]).map(parameters => {
    nextRender();
    const args = Array.isArray(parameters) ? parameters : [parameters];
    try {
      return entry.isComponent === false || !/^[A-Z]/.test(entry.fn.name)
        ? ["returns", at("root", () => render(entry.fn(...args), "root"))]
        : ["returns", render(React.createElement(entry.fn, args[0]), "root")];
    } catch (error) {
      return ["throws", error?.constructor?.name ?? typeof error];
    }
  });
}
writeFileSync(directory + ".json", JSON.stringify(results));
process.exit(0);
