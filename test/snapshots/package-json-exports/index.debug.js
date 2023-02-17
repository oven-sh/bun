import {
__require as require_ab102cbd93061951
} from "http://localhost:8080/bun:wrap";
import * as $a4de9925 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = require_ab102cbd93061951($a4de9925);
import * as $725c641 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = require_ab102cbd93061951($725c641);
import * as $fbe61cb7 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = require_ab102cbd93061951($fbe61cb7);
import * as $6a256e60 from "http://localhost:8080/package-json-exports/node_modules/js-only-exports/browser/js-file.js";
var JSFileExtensionOnly = require_ab102cbd93061951($6a256e60);
export async function test() {
  console.assert(InexactRoot.target === "browser");
  console.assert(InexactFile.target === "browser");
  console.assert(ExactFile.target === "browser");
  console.assert(JSFileExtensionOnly.isJS === true);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/package-json-exports/index.js.map
