// Prints the class names that the "Property" edges out of CommonJS module objects point at.
module._compile = function overriddenCompileFn() {};
module.children; // materializes the lazily-built children array

const snapshot = Bun.generateHeapSnapshot();
const { nodes, edges, nodeClassNames, edgeNames, edgeTypes, type } = snapshot;

const nodeStride = type === "GCDebugging" ? 7 : 4;
const moduleClassIndex = nodeClassNames.indexOf("Module");
if (moduleClassIndex === -1) throw new Error("no Module class in snapshot");

// Edges reference node identifiers (nodes[i + 0]), not node indices.
const classNameOfId = new Map();
const moduleIds = new Set();
for (let i = 0; i < nodes.length; i += nodeStride) {
  classNameOfId.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  if (nodes[i + 2] === moduleClassIndex) moduleIds.add(nodes[i]);
}

const propertyEdgeType = edgeTypes.indexOf("Property");
// Module.prototype and the Module constructor are "Module" nodes too, but only a module object has an "exports" edge.
const moduleObjectIds = new Set();
for (let i = 0; i < edges.length; i += 4) {
  if (edges[i + 2] !== propertyEdgeType) continue;
  if (moduleIds.has(edges[i]) && edgeNames[edges[i + 3]] === "exports") moduleObjectIds.add(edges[i]);
}
if (moduleObjectIds.size === 0) throw new Error("no module object in snapshot");

const targetsByName = {};
for (let i = 0; i < edges.length; i += 4) {
  if (edges[i + 2] !== propertyEdgeType) continue;
  if (!moduleObjectIds.has(edges[i])) continue;
  const name = edgeNames[edges[i + 3]];
  (targetsByName[name] ??= []).push(classNameOfId.get(edges[i + 1]));
}

console.log(JSON.stringify(targetsByName));
