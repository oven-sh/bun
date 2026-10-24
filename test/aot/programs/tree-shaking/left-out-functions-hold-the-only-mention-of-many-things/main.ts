// The bodies that are left out are the only places that mention a library module's function, a global, a regular expression, a template, a big number, a private name, an import() and a JSX-free tagged template. What is left of the file builds and runs without them.
import { helper } from "./helper";

function mentionsLibrary() { return require("node:fs").readFileSync("/dev/null").length; }
function mentionsGlobals() { return [structuredClone, queueMicrotask, WebSocket, Intl.DateTimeFormat, WeakRef, Atomics, SharedArrayBuffer].length; }
function mentionsLiterals() { return [/(?<year>\d{4})/u.exec("2026")?.groups?.year, 123456789012345678901234567890n, `a${1}b`, String.raw`\n`, 0x1fn, 1_000]; }
async function mentionsImport() { return (await import("./late")).late(); }
function mentionsHelper() { return helper(); }
function mentionsBun() { return [Bun.file("/dev/null").size, Bun.hash("x"), Bun.version]; }
class MentionsPrivate { #a = 1; static has(value: object) { return #a in value; } }

console.log("built and ran");
