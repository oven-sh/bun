// whatKeepsAlive(className) says, on Linux, why the collector still holds the objects of a class: the roots that reach them, and where on
// the stack the address of a cell that reaches them lies, with the way from that cell and the frame records around the word.
// A place in code is `<file>+0x<offset in the file>`.
const { closeSync, openSync, readFileSync, readSync } = require("fs");
const { generateHeapSnapshotForDebugging } = require("bun:jsc");

function cellsThatReach(className) {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = generateHeapSnapshotForDebugging();
  const byId = new Map();
  for (let at = 0; at < nodes.length; at += 7)
    byId.set(nodes[at], { name: nodeClassNames[nodes[at + 2]], address: nodes[at + 5], from: [] });
  for (let at = 0; at < edges.length; at += 4) {
    const type = edgeTypes[edges[at + 2]];
    const name =
      type === "Property" || type === "Variable" ? edgeNames[edges[at + 3]] : type === "Index" ? edges[at + 3] : "";
    if (edges[at]) byId.get(edges[at + 1])?.from.push([edges[at], `${type} ${name}`.trim()]);
  }
  // From the objects of the class back to everything that reaches them: `next` is the first step of a shortest way.
  const next = new Map();
  let wave = [...byId].filter(([, node]) => node.name === className).map(([id]) => id);
  for (const id of wave) next.set(id, null);
  while (wave.length) {
    const found = [];
    for (const id of wave)
      for (const [from, edge] of byId.get(id).from) if (!next.has(from)) (next.set(from, [id, edge]), found.push(from));
    wave = found;
  }
  const wayFrom = id => {
    let way = byId.get(id).name;
    for (let step = next.get(id), steps = 0; step && steps < 12; step = next.get(step[0]), steps++)
      way += ` -[${step[1]}]-> ${byId.get(step[0]).name}`;
    return way;
  };
  const listed = [];
  for (let at = 0; at < roots.length; at += 3)
    if (next.has(roots[at]))
      listed.push(`root (${labels[roots[at + 1]]}) ${byId.get(roots[at]).address}: ${wayFrom(roots[at])}`);
  // The snapshot does not list what the scan of the stack found, so each cell that reaches the class is looked for on the stack.
  return { listed, reaching: new Map([...next.keys()].map(id => [BigInt(byId.get(id).address), wayFrom(id)])) };
}

function whatKeepsAlive(className) {
  const { listed, reaching: wanted } = cellsThatReach(className);
  const lines = [`${wanted.size} cells reach a ${className}`, ...listed];
  const mappings = readFileSync("/proc/self/maps", "utf8")
    .split("\n")
    .filter(line => line)
    .map(line => {
      const [range, permissions, offset, , , path = ""] = line.split(/ +/);
      const [start, end] = range.split("-").map(text => BigInt("0x" + text));
      return { start, end, permissions, offset: BigInt("0x" + offset), path };
    });
  const stack = mappings.find(({ path }) => path === "[stack]");
  if (!stack) return [...lines, "there is no [stack]"].join("\n");
  const bytes = Buffer.alloc(Number(stack.end - stack.start));
  const memory = openSync("/proc/self/mem", "r");
  readSync(memory, bytes, 0, bytes.length, stack.start);
  closeSync(memory);
  const words = new BigUint64Array(bytes.buffer, bytes.byteOffset, bytes.length >> 3);
  const addressOf = index => stack.start + BigInt(index) * 8n;
  const code = mappings.filter(({ permissions }) => permissions.includes("x"));
  const place = word => {
    const mapping = code.find(({ start, end }) => start <= word && word < end);
    return (
      mapping &&
      `${mapping.path.split("/").pop() || "anonymous"}+0x${(word - mapping.start + mapping.offset).toString(16)}`
    );
  };
  // A frame record is the address of the caller's record, higher on the stack, and a return address.
  const isRecord = index =>
    words[index] > addressOf(index) && words[index] < stack.end && !(words[index] & 15n) && place(words[index + 1]);
  let shown = 0;
  for (let index = words.length - 1; index >= 0 && shown < 16; index--) {
    if (!wanted.has(words[index])) continue;
    shown++;
    const below = [];
    for (let at = (index - 1) & ~1; at >= 0 && below.length < 3; at -= 2)
      if (isRecord(at)) below.push(`-0x${((index - at) * 8).toString(16)} ${place(words[at + 1])}`);
    const above = [];
    let at = (index + 1) & ~1;
    while (at < words.length - 1 && !isRecord(at)) at += 2;
    for (; at < words.length - 1 && isRecord(at) && above.length < 10; at = Number((words[at] - stack.start) / 8n))
      above.push(`+0x${((at - index) * 8).toString(16)} ${place(words[at + 1])}`);
    lines.push(
      `0x${words[index].toString(16)} (${wanted.get(words[index])}) lies at 0x${addressOf(index).toString(16)}, 0x${(stack.end - addressOf(index)).toString(16)} below the end of the stack | records below: ${below.join(", ")} | records above, each the caller of the one before: ${above.join(", ")}`,
    );
  }
  return lines.join("\n");
}

module.exports = { whatKeepsAlive };
