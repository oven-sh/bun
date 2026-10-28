// For a test that finds a stopped server still in the heap: what the heap says about each such cell.
import { generateHeapSnapshotForDebugging } from "bun:jsc";

// bun-types does not declare it.
declare module "bun:jsc" {
  function generateHeapSnapshotForDebugging(): unknown;
}

function describeServers(): string {
  const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } =
    generateHeapSnapshotForDebugging() as any;
  const className = new Map<number, string>();
  for (let i = 0; i < nodes.length; i += 7) className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  const outgoing = new Map<number, [number, string][]>();
  const incoming = new Map<number, [number, string][]>();
  for (let i = 0; i < edges.length; i += 4) {
    const type = edgeTypes[edges[i + 2]];
    const name = type + ":" + (type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3]);
    if (!outgoing.has(edges[i])) outgoing.set(edges[i], []);
    outgoing.get(edges[i])!.push([edges[i + 1], name]);
    if (!incoming.has(edges[i + 1])) incoming.set(edges[i + 1], []);
    incoming.get(edges[i + 1])!.push([edges[i], name]);
  }
  const reasons = new Map<number, string[]>();
  const reachedFrom = new Map<number, [number, string] | undefined>();
  const queue: number[] = [];
  for (let i = 0; i < roots.length; i += 3) {
    const reason = String(labels[roots[i + 1]] ?? roots[i + 1]);
    if (!reasons.has(roots[i])) reasons.set(roots[i], []);
    reasons.get(roots[i])!.push(reason);
    if (reachedFrom.has(roots[i]) || reason.includes("DOMGCOutput")) continue;
    reachedFrom.set(roots[i], undefined);
    queue.push(roots[i]);
  }
  for (let i = 0; i < queue.length; i++)
    for (const [child, edge] of outgoing.get(queue[i]) ?? [])
      if (!reachedFrom.has(child)) (reachedFrom.set(child, [queue[i], edge]), queue.push(child));

  const lines: string[] = [];
  for (const [id, name] of className) {
    if (name !== "HTTPServer" && name !== "DebugHTTPServer") continue;
    const path: string[] = [];
    let at = id;
    for (let step = reachedFrom.get(at); step; at = step[0], step = reachedFrom.get(at))
      path.unshift(`-${step[1]}-> ${className.get(at)}`);
    const list = (from: [number, string][] | undefined) =>
      (from ?? []).map(([cell, edge]) => `${edge} ${className.get(cell)}`).join(", ") || "none";
    lines.push(
      `${name}#${id}`,
      `  a root reaches it: ${reachedFrom.has(id) ? `root(${reasons.get(at)}) ${className.get(at)} ${path.join(" ")}` : "no"}`,
      `  its own root entries: ${reasons.get(id) ?? "none"}`,
      `  pointed at by: ${list(incoming.get(id))}`,
      `  points at: ${list(outgoing.get(id))}`,
    );
  }
  return lines.join("\n") || "no server in the heap";
}

/** From a timer callback, so that the caller's frames are suspended and hold what they hold through the heap. */
let pending: Promise<string> | undefined;
export function whatKeepsAServer(): Promise<string> {
  return (pending = new Promise(resolve => setTimeout(() => resolve(describeServers()), 0)));
}
