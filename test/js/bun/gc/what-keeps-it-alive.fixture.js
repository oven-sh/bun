// whatKeepsAlive(className) says, on Linux and macOS, why the collector still holds the objects of a class: the roots that reach them, and
// where on the stack the address of a cell that reaches them lies, with the way from that cell and the frame records around the word.
// A place in code is `<file>+0x<offset in the file>`. On macOS the offset is from the start of the image, and the nearest symbol follows.
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

// The words of the main thread's stack, and the place in code that a word points to.
function stackOnLinux() {
  const mappings = readFileSync("/proc/self/maps", "utf8")
    .split("\n")
    .filter(line => line)
    .map(line => {
      const [range, permissions, offset, , , path = ""] = line.split(/ +/);
      const [start, end] = range.split("-").map(text => BigInt("0x" + text));
      return { start, end, permissions, offset: BigInt("0x" + offset), path };
    });
  const stack = mappings.find(({ path }) => path === "[stack]");
  if (!stack) return;
  const bytes = Buffer.alloc(Number(stack.end - stack.start));
  const memory = openSync("/proc/self/mem", "r");
  readSync(memory, bytes, 0, bytes.length, stack.start);
  closeSync(memory);
  const code = mappings.filter(({ permissions }) => permissions.includes("x"));
  const place = word => {
    const mapping = code.find(({ start, end }) => start <= word && word < end);
    return (
      mapping &&
      `${mapping.path.split("/").pop() || "anonymous"}+0x${(word - mapping.start + mapping.offset).toString(16)}`
    );
  };
  return { start: stack.start, end: stack.end, bytes, place };
}

function stackOnMacOS() {
  const { CString, dlopen, ptr, toArrayBuffer } = require("bun:ffi");
  const { symbols } = dlopen("/usr/lib/libSystem.B.dylib", {
    pthread_self: { args: [], returns: "ptr" },
    pthread_get_stackaddr_np: { args: ["ptr"], returns: "ptr" },
    pthread_get_stacksize_np: { args: ["ptr"], returns: "u64" },
    dladdr: { args: ["ptr", "ptr"], returns: "int" },
  });
  const thread = symbols.pthread_self();
  const end = BigInt(symbols.pthread_get_stackaddr_np(thread));
  // The frames of the event loop are at the end of the stack.
  const length = Math.min(Number(symbols.pthread_get_stacksize_np(thread)), 1 << 20);
  const start = end - BigInt(length);
  const bytes = Buffer.from(toArrayBuffer(Number(start), 0, length).slice(0));
  // Dl_info: the path of the image, its base, the name of the nearest symbol, its address.
  const info = new BigUint64Array(4);
  const place = word => {
    if (word < 0x1000n || word >= 1n << 47n || !symbols.dladdr(Number(word), ptr(info))) return;
    const image = `${new CString(Number(info[0]))}`.split("/").pop();
    return `${image}+0x${(word - info[1]).toString(16)}${info[2] ? ` (${new CString(Number(info[2]))})` : ""}`;
  };
  return { start, end, bytes, place };
}

function whatKeepsAlive(className) {
  const { listed, reaching: wanted } = cellsThatReach(className);
  const lines = [`${wanted.size} cells reach a ${className}`, ...listed];
  // bun:ffi requires the JIT.
  if (process.platform === "darwin" && process.env.BUN_JSC_useJIT === "0")
    return [...lines, "without the JIT the stack cannot be read"].join("\n");
  const stack = process.platform === "darwin" ? stackOnMacOS() : stackOnLinux();
  if (!stack) return [...lines, "there is no [stack]"].join("\n");
  const { bytes, place } = stack;
  const words = new BigUint64Array(bytes.buffer, bytes.byteOffset, bytes.length >> 3);
  const addressOf = index => stack.start + BigInt(index) * 8n;
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
