import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $147f6594 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = require($147f6594);
import * as $f9f33cd5 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = require($f9f33cd5);
import * as $efd1f056 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = require($efd1f056);
import * as $3e697ad7 from "http://localhost:8080/package-json-exports/node_modules/js-only-exports/browser/js-file.js";
var JSFileExtensionOnly = require($3e697ad7);
export async function test() {
  console.assert(InexactRoot.target === "browser");
  console.assert(InexactFile.target === "browser");
  console.assert(ExactFile.target === "browser");
  console.assert(JSFileExtensionOnly.isJS === true);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/package-json-exports/index.js.map
