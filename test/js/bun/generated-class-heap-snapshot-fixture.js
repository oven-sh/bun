// Prints the class names each "Property" edge out of a Request node points at.
// Request.prototype shares the "Request" class name with instances, so every
// accessor on the prototype also shows up under its property name; the test
// asserts on edge targets, not on names.
const request = new Request("https://example.com/", { method: "POST", body: "body" });
request.headers; // fills the cached headers slot
request.signal; // fills the cached signal slot
// request.body and request.url are never read, so their cached slots stay empty.
globalThis.request = request;

const snapshot = Bun.generateHeapSnapshot();
const { nodes, edges, nodeClassNames, edgeNames, edgeTypes, type } = snapshot;

const nodeStride = type === "GCDebugging" ? 7 : 4;
const requestClassIndex = nodeClassNames.indexOf("Request");
if (requestClassIndex === -1) throw new Error("no Request class in snapshot");

// Edges reference node identifiers (nodes[i + 0]), not node indices.
const classNameOfId = new Map();
const requestIds = new Set();
for (let i = 0; i < nodes.length; i += nodeStride) {
  classNameOfId.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  if (nodes[i + 2] === requestClassIndex) requestIds.add(nodes[i]);
}

const propertyEdgeType = edgeTypes.indexOf("Property");
// Request.prototype has a "constructor" edge, which would collide with Object.prototype.constructor.
const targetsByName = { __proto__: null };
for (let i = 0; i < edges.length; i += 4) {
  if (edges[i + 2] !== propertyEdgeType) continue;
  if (!requestIds.has(edges[i])) continue;
  const name = edgeNames[edges[i + 3]];
  (targetsByName[name] ??= []).push(classNameOfId.get(edges[i + 1]));
}

console.log(JSON.stringify(targetsByName));
