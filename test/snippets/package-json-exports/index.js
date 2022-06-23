import * as InexactRoot from "inexact";
import * as InexactFile from "inexact/file";
import * as ExactFile from "inexact/foo";
import * as JSFileExtensionOnly from "js-only-exports/js-file";

export async function test() {
  console.assert(InexactRoot.target === "browser");
  console.assert(InexactFile.target === "browser");
  console.assert(ExactFile.target === "browser");
  console.assert(JSFileExtensionOnly.isJS === true);
  return testDone(import.meta.url);
}
