// Code that does not know what it is handed asks namespace objects for names that some of them export and some do not (`node?.universal?.[option] ?? node?.server?.[option]`). A namespace never gains an export, so a name it
// lacks is answered without asking the run time every time; a store to it still throws, `in` says false, and what an object in its place has is still found.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
const option = (node, name) => node?.universal?.[name] ?? node?.server?.[name];
const readUniversal = (node) => node.universal;
const readServer = (node) => node.server;
const readNowhere = (node) => node.nowhere;
const both = await import("./both.js");
const universalOnly = await import("./universal.js");
const serverOnly = await import("./server.js");
const neither = await import("./neither.js");
const starred = await import("./starred.js");
const nodes = [both, universalOnly, serverOnly, neither, starred];
const names = ["both", "universal", "server", "neither", "starred"];
function tell(tag) {
  lines.push(tag + ": " + nodes.map((node, i) => names[i] + " " + [typeof readUniversal(node), typeof readServer(node), typeof readNowhere(node), option(node, "ssr"), option(node, "csr"), option(node, "missing")].join()).join(" | "));
}
tell("at first");
{
  for (let i = 0; i < 100; i++) for (const node of nodes) option(node, "ssr");
  const before = count("operationAOTGetByIdAndCache");
  let seen = 0;
  for (let i = 0; i < 3000; i++) for (const node of nodes) seen += option(node, "ssr") === undefined ? 0 : 1;
  const asked = count("operationAOTGetByIdAndCache") - before;
  lines.push("rounds " + seen);
  lines.push(asked <= 200 ? "the reads asked the run time at most 200 times" : "the reads asked the run time " + asked + " times");
}
tell("behind the rounds");
lines.push("stored to: " + nodes.map((node) => attempt(() => { node.server = 1; return "stored"; })).join());
lines.push("a name nobody has stored to: " + nodes.map((node) => attempt(() => { node.nowhere = 1; return "stored"; })).join());
lines.push("in: " + nodes.map((node) => ["universal" in node, "server" in node, "nowhere" in node].join()).join(" | "));
lines.push("own: " + nodes.map((node) => [Object.hasOwn(node, "universal"), Object.hasOwn(node, "server"), Object.hasOwn(node, "nowhere")].join()).join(" | "));
lines.push("deleted: " + nodes.map((node) => attempt(() => delete node.nowhere) + " " + attempt(() => delete node.server)).join(" | "));
lines.push("defined: " + nodes.map((node) => attempt(() => Object.defineProperty(node, "nowhere", { value: 1 }) && "defined")).join());
lines.push("marker: " + nodes.map((node) => [typeof node.__esModule, typeof node.then, typeof node.toString, typeof node.constructor, node[Symbol.toStringTag]].join()).join(" | "));
tell("behind the attempts");
const plain = [{ universal: { ssr: "plain" } }, { server: { ssr: "of the server" } }, {}, Object.create({ server: { ssr: "inherited" } })];
lines.push("objects at the same places: " + plain.map((node) => [typeof readUniversal(node), typeof readServer(node), typeof readNowhere(node), option(node, "ssr")].join()).join(" | "));
tell("at last");
console.log(lines.join("\n"));
