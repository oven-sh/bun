// Diagnostic only. Says why cells of `types` are still in the heap: the path from a root, or, when no
// root reaches one, the cells that can reach it and every word of this thread's stack that points at them.
import { dlopen, toArrayBuffer } from "bun:ffi";
import { generateHeapSnapshotForDebugging } from "bun:jsc";
import { openSync, readFileSync, readSync } from "node:fs";

export function report(types, extraAddresses = []) {
  const say = line => console.error("DIAG " + line);
  const island = new Map(); // address -> [class, size]
  try {
    const { nodes, edges, roots, nodeClassNames, edgeTypes, edgeNames, labels } = generateHeapSnapshotForDebugging();
    const info = new Map(),
      outgoing = new Map(),
      incoming = new Map();
    for (let i = 0; i < nodes.length; i += 7)
      info.set(nodes[i], { cls: nodeClassNames[nodes[i + 2]], size: nodes[i + 1], address: Number(nodes[i + 5]) });
    for (let i = 0; i < edges.length; i += 4) {
      const type = edgeTypes[edges[i + 2]];
      const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
      (outgoing.get(edges[i]) ?? outgoing.set(edges[i], []).get(edges[i])).push([edges[i + 1], type + ":" + name]);
      (incoming.get(edges[i + 1]) ?? incoming.set(edges[i + 1], []).get(edges[i + 1])).push(edges[i]);
    }
    const reason = new Map(),
      from = new Map(),
      queue = [];
    for (let i = 0; i < roots.length; i += 3) {
      const why = String(labels[roots[i + 1]] ?? roots[i + 1]);
      if (!reason.has(roots[i])) reason.set(roots[i], why);
      if (from.has(roots[i]) || why.includes("DOMGCOutput")) continue;
      from.set(roots[i], undefined);
      queue.push(roots[i]);
    }
    for (let i = 0; i < queue.length; i++)
      for (const [child, edge] of outgoing.get(queue[i]) ?? [])
        if (!from.has(child)) (from.set(child, [queue[i], edge]), queue.push(child));
    const targets = [...info].filter(([, cell]) => types.includes(cell.cls)).map(([id]) => id);
    say(
      `snapshot: ${info.size} cells, ${edges.length / 4} edges, ${roots.length / 3} roots; cells of ${types}: ${targets.length}`,
    );
    const hex = n => "0x" + n.toString(16);
    for (const target of targets) {
      if (from.has(target)) {
        const path = [];
        let at = target;
        for (let step = from.get(at); step; at = step[0], step = from.get(at))
          path.unshift(`-${step[1]}-> ${info.get(at).cls}`);
        say(
          `cell ${target} ${info.get(target).cls} ${hex(info.get(target).address)}: REACHED: root(${reason.get(at)}) ${info.get(at).cls} ${path.join(" ")}`,
        );
        continue;
      }
      const seen = new Set([target]),
        back = [target];
      for (let i = 0; i < back.length; i++)
        for (const parent of incoming.get(back[i]) ?? []) if (!seen.has(parent)) (seen.add(parent), back.push(parent));
      say(
        `cell ${target} ${info.get(target).cls} ${hex(info.get(target).address)}: no root reaches it; cells that can reach it: ${seen.size}, of which a root reaches ${[...seen].filter(id => from.has(id)).length}`,
      );
      for (const id of [...seen].sort((a, b) => a - b)) {
        const cell = info.get(id);
        island.set(cell.address, [cell.cls, cell.size]);
        if (seen.size <= 60 || !(incoming.get(id)?.length > 0))
          say(
            `  cell ${id} ${cell.cls} ${hex(cell.address)} size ${cell.size} incoming ${incoming.get(id)?.length ?? 0} in roots ${reason.has(id) ? reason.get(id) : "no"}`,
          );
      }
    }
  } catch (error) {
    say("snapshot stage failed: " + (error?.stack ?? error));
  }
  for (const address of extraAddresses) island.set(address, ["(given)", 16]);
  if (island.size === 0) return say("nothing to look for on the stack");
  try {
    let low, high, imageLow, slide, bytes;
    if (process.platform === "darwin") {
      const { symbols: c } = dlopen("libSystem.B.dylib", {
        pthread_self: { args: [], returns: "u64" },
        pthread_get_stackaddr_np: { args: ["u64"], returns: "u64" },
        pthread_get_stacksize_np: { args: ["u64"], returns: "u64" },
        _dyld_get_image_vmaddr_slide: { args: ["u32"], returns: "i64" },
        _dyld_get_image_header: { args: ["u32"], returns: "u64" },
      });
      const self = c.pthread_self();
      high = Number(c.pthread_get_stackaddr_np(self));
      low = high - Math.min(Number(c.pthread_get_stacksize_np(self)) - 65536, 1 << 20);
      slide = Number(c._dyld_get_image_vmaddr_slide(0));
      imageLow = Number(c._dyld_get_image_header(0));
      bytes = toArrayBuffer(low, 0, high - low).slice(0);
    } else {
      const maps = readFileSync("/proc/self/maps", "utf8").split("\n");
      [low, high] = maps
        .find(line => line.endsWith("[stack]"))
        .split(" ")[0]
        .split("-")
        .map(x => parseInt(x, 16));
      slide = 0;
      imageLow = parseInt(maps[0].split("-")[0], 16);
      const buffer = Buffer.alloc(high - low);
      readSync(openSync("/proc/self/mem", "r"), buffer, 0, buffer.length, low);
      bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
    }
    const hex = n => "0x" + n.toString(16);
    const imageHigh = imageLow + 400 * 1048576;
    say(`stack window ${hex(low)}-${hex(high)}; image at ${hex(imageLow)}, slide ${hex(slide)}`);
    const halves = new Uint32Array(bytes),
      count = halves.length >> 1;
    const word = i => halves[2 * i + 1] * 4294967296 + halves[2 * i];
    const ranges = [...island]
      .map(([address, [cls, size]]) => [address, address + Math.max(size, 16), cls])
      .sort((a, b) => a[0] - b[0]);
    const least = ranges[0][0],
      most = Math.max(...ranges.map(range => range[1]));
    const hits = [];
    for (let i = 0; i < count; i++) {
      const value = word(i);
      if (value < least || value >= most) continue;
      for (const [start, end, cls] of ranges)
        if (value >= start && value < end) hits.push([low + i * 8, value, cls, value - start]);
    }
    // The longest chain of [caller's rbp, return address] records.
    const code = value => value > 0x100000 && value < 2 ** 47 && !(value >= low && value < high);
    let chain = [];
    const tried = new Set();
    for (let i = 0; i < count - 1; i++) {
      let frame = low + i * 8;
      if (tried.has(frame)) continue;
      const found = [];
      for (;;) {
        const at = (frame - low) / 8;
        if (at < 0 || at + 1 >= count || !code(word(at + 1))) break;
        found.push([frame, word(at + 1)]);
        tried.add(frame);
        const next = word(at);
        if (!(next > frame && next < high)) break;
        frame = next;
      }
      if (found.length > chain.length) chain = found;
    }
    const where = pc => (pc >= imageLow && pc < imageHigh ? "image " + hex(pc - slide) : "other " + hex(pc));
    say(
      `words that point into those cells: ${hits.length}; frame chain: ${chain.length} frames from ${hex(chain[0]?.[0] ?? 0)}`,
    );
    for (const [address, value, cls, offset] of hits) {
      const k = chain.findIndex(([frame]) => address <= frame);
      if (address < (chain[0]?.[0] ?? 0) - 4096)
        say(`  ${hex(address)}: ${hex(value)} = ${cls}+${offset}: far below the innermost frame`);
      else if (k < 0) say(`  ${hex(address)}: ${hex(value)} = ${cls}+${offset}: above the chain`);
      else
        say(
          `  ${hex(address)}: ${hex(value)} = ${cls}+${offset}: frame #${k}, rbp-${hex(chain[k][0] - address)}, frame size ${hex(chain[k][0] - (chain[k - 1]?.[0] ?? address))}, its callee returns to ${k ? where(chain[k - 1][1]) : "?"}`,
        );
    }
    chain
      .slice(0, 40)
      .forEach(([frame], k) =>
        say(`  #${k} rbp ${hex(frame)} owner has ${k ? where(chain[k - 1][1]) : "(innermost)"}`),
      );
  } catch (error) {
    say("stack stage failed: " + (error?.stack ?? error));
  }
}
