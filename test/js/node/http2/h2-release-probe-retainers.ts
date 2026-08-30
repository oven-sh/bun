// Print retainer chains for every live object whose class name matches `name`.
export function retainerChains(name: string, maxDepth = 8, maxPaths = 6): string {
  const snap = JSON.parse(Bun.generateHeapSnapshot("v8") as unknown as string);
  const meta = snap.snapshot.meta;
  const nf = meta.node_fields, ef = meta.edge_fields;
  const NFC = nf.length, EFC = ef.length;
  const nTypeOff = nf.indexOf("type"), nNameOff = nf.indexOf("name"), nEdgeCountOff = nf.indexOf("edge_count"), nIdOff = nf.indexOf("id");
  const eTypeOff = ef.indexOf("type"), eNameOff = ef.indexOf("name_or_index"), eToOff = ef.indexOf("to_node");
  const nodeTypes = meta.node_types[nTypeOff], edgeTypes = meta.edge_types[eTypeOff];
  const strings: string[] = snap.strings, nodes: number[] = snap.nodes, edges: number[] = snap.edges;
  const nodeCount = nodes.length / NFC;
  // first edge index per node
  const firstEdge = new Int32Array(nodeCount + 1);
  for (let i = 0, e = 0; i < nodeCount; i++) { firstEdge[i] = e; e += nodes[i * NFC + nEdgeCountOff] * EFC; }
  firstEdge[nodeCount] = edges.length;
  // reverse edges: for each node, list of (fromNode, edgeIndex)
  const revCount = new Int32Array(nodeCount);
  for (let e = 0; e < edges.length; e += EFC) revCount[edges[e + eToOff] / NFC]++;
  const revStart = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) revStart[i + 1] = revStart[i] + revCount[i];
  const revFrom = new Int32Array(revStart[nodeCount]), revEdge = new Int32Array(revStart[nodeCount]);
  const fill = new Int32Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EFC) {
    const to = edges[e + eToOff] / NFC; const k = revStart[to] + fill[to]++; revFrom[k] = n; revEdge[k] = e;
  }
  const nodeName = (n: number) => strings[nodes[n * NFC + nNameOff]];
  const nodeType = (n: number) => nodeTypes[nodes[n * NFC + nTypeOff]];
  const edgeLabel = (e: number) => { const t = edgeTypes[edges[e + eTypeOff]]; const ni = edges[e + eNameOff]; return t === "element" || t === "hidden" ? `[${ni}]` : `${strings[ni]}`; } ;
  const out: string[] = [];
  const targets: number[] = [];
  for (let n = 0; n < nodeCount; n++) if (nodeName(n) === name && nodeType(n) === "object") targets.push(n);
  out.push(`${targets.length} live ${name} objects`);
  for (const t of targets) {
    out.push(`--- ${name} @${nodes[t * NFC + nIdOff]}`);
    // BFS backwards to a synthetic root, record parent pointers
    const prev = new Int32Array(nodeCount).fill(-1), prevEdge = new Int32Array(nodeCount).fill(-1);
    const q = [t]; prev[t] = t; let found: number[] = [];
    for (let qi = 0; qi < q.length && found.length < maxPaths; qi++) {
      const n = q[qi];
      for (let k = revStart[n]; k < revStart[n + 1]; k++) {
        const f = revFrom[k]; if (prev[f] !== -1) continue;
        if (edgeTypes[edges[revEdge[k] + eTypeOff]] === "weak") continue;
        prev[f] = n; prevEdge[f] = revEdge[k];
        if (nodeType(f) === "synthetic") { found.push(f); if (found.length >= maxPaths) break; } else q.push(f);
      }
    }
    if (found.length === 0) out.push("  (no strong path to a root found)");
    for (const r of found) {
      const chain: string[] = []; let n = r, depth = 0;
      while (n !== t && depth++ < 64) { chain.push(`${nodeType(n) === "synthetic" ? "(" + nodeName(n) + ")" : nodeName(n)} --${edgeLabel(prevEdge[n])}--> `); n = prev[n]; }
      chain.push(name);
      out.push("  " + chain.slice(Math.max(0, chain.length - maxDepth - 1)).join(""));
    }
  }
  return out.join("\n");
}
