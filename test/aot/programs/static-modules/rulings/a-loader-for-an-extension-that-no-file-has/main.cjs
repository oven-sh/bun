// A package registers a loader for files of its own kind when it is required, as handlebars does for ".hbs". No file of the executable has that extension, so the loader changes nothing that was compiled:
// it is stored, from sloppy and from strict code, and nothing throws. A loader for an extension that a file of the executable has is refused: each-of-the-five-loader-hooks-is-read-only.
const loader = (module, filename) => {
  module.exports = "loaded by the hook: " + filename.slice(filename.lastIndexOf("/") + 1);
};
if (typeof require !== "undefined" && require.extensions) {
  require.extensions[".handlebars"] = loader;
  require.extensions[".hbs"] = loader;
}
console.log("sloppy:", require.extensions[".hbs"] === loader, require("node:module")._extensions[".handlebars"] === loader);
console.log(require("./strict.mjs").outcome);
console.log(Object.keys(require.extensions).filter(key => !key.endsWith("s") || key.includes("b")).join());
