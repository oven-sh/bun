// `typeof window`, `typeof document`, `typeof Bun`, `typeof process`, `typeof require` and `process.browser` are asked after the program has given itself a window and a document. Each answer calls its own function.
globalThis.window = globalThis;
globalThis.document = { title: "made up" };

function hasWindow() { return "has a window"; } function noWindow() { return "no window"; }
function hasDocument() { return "has a document"; } function noDocument() { return "no document"; }
function hasBun() { return "has Bun"; } function noBun() { return "no Bun"; }
function hasProcess() { return "has process"; } function noProcess() { return "no process"; }
function hasRequire() { return "has require"; } function noRequire() { return "no require"; }
function isBrowser() { return "a browser"; } function notBrowser() { return "not a browser"; }
function hasDeno() { return "has Deno"; } function noDeno() { return "no Deno"; }

console.log(typeof window !== "undefined" ? hasWindow() : noWindow());
console.log(typeof document === "undefined" ? noDocument() : hasDocument());
console.log(typeof Bun !== "undefined" ? hasBun() : noBun());
console.log(typeof process === "object" ? hasProcess() : noProcess());
console.log(typeof require === "function" ? hasRequire() : noRequire());
console.log(process.browser ? isBrowser() : notBrowser());
console.log(typeof Deno === "undefined" ? noDeno() : hasDeno());
