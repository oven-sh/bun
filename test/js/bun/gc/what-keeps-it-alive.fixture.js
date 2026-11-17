// whatKeepsAlive(className) says, on Linux and Windows, why the collector still holds the objects of a class: the roots that reach them, and where on
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

// Frames have no records there, so this lists each address in the executable around the word: some are return addresses of live frames.
function placesOnWindows(wanted) {
  const { dlopen, ptr, read, toArrayBuffer } = require("bun:ffi");
  const { symbols: kernel } = dlopen("kernel32.dll", {
    GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" },
    GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
    VirtualQuery: { args: ["u64", "ptr", "u64"], returns: "u64" },
  });
  const limits = new BigUint64Array(2);
  kernel.GetCurrentThreadStackLimits(ptr(limits), ptr(limits, 8));
  const region = Buffer.alloc(48);
  const isReadable = page =>
    kernel.VirtualQuery(page, ptr(region), 48n) &&
    region.readUInt32LE(32) === 0x1000 &&
    region.readUInt32LE(36) === 0x04;
  const end = limits[1];
  let start = end;
  while (start > limits[0] && isReadable(start - 4096n)) start -= 4096n;
  const words = new BigUint64Array(toArrayBuffer(Number(start), 0, Number(end - start)).slice(0));

  const { symbols: debug } = dlopen("dbghelp.dll", {
    SymInitializeW: { args: ["i64", "ptr", "i32"], returns: "i32" },
    SymFromAddr: { args: ["i64", "u64", "ptr", "ptr"], returns: "i32" },
  });
  debug.SymInitializeW(-1n, null, 1);
  const base = kernel.GetModuleHandleW(null);
  const size = read.u32(base, read.u32(base, 0x3c) + 0x50);
  const symbol = Buffer.alloc(88 + 200);
  symbol.writeUInt32LE(88, 0);
  symbol.writeUInt32LE(200, 80);
  const displacement = new BigUint64Array(1);
  const place = word => {
    const offset = word - BigInt(base);
    if (offset < 0n || offset >= size) return;
    const found = debug.SymFromAddr(-1n, word, ptr(displacement), ptr(symbol));
    const name = found ? symbol.toString("latin1", 84, 84 + Math.min(symbol.readUInt32LE(76), 199)) : "";
    return `exe+0x${offset.toString(16)} ${name}${found ? `+0x${displacement[0].toString(16)}` : ""}`;
  };
  // What `deref()` returns is held until the end of the turn.
  const holds = word => wanted.has(word) && !wanted.get(word).includes("WeakRef");
  const last = Math.max(0, words.findLastIndex(holds) - 256);
  const lines = [];
  for (let index = words.length - 1; index >= last; index--) {
    const what = holds(words[index]) ? `>>> ${wanted.get(words[index])}` : place(words[index]);
    if (what) lines.push(`0x${((words.length - index) * 8).toString(16)} below the end of the stack: ${what}`);
  }
  return lines;
}

function whatKeepsAlive(className) {
  const { listed, reaching: wanted } = cellsThatReach(className);
  const lines = [`${wanted.size} cells reach a ${className}`, ...listed];
  if (process.platform === "win32") return [...lines, ...placesOnWindows(wanted)].join("\n");
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
