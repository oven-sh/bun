// whatKeepsAlive(className) says, on Linux and on Windows x64, why the collector still holds the objects of a class: the roots that reach
// them, and where on the stack the address of a cell that reaches them lies, with the way from that cell and the frames around the word.
// On Linux a place in code is `<file>+0x<offset in the file>`, and the frames are the frame records around the word.
// On Windows a place in code is `<image>+0x<offset in the image>`, and the frames are the live ones: the frame that has the word, and its
// callers. The names of the places follow where the symbols of an image lie beside it. bun:ffi reads the stack there, and it needs the JIT.
// `say` gets each line as soon as it is known, so that a run that ends early has said what it knew.
const { closeSync, openSync, readFileSync, readSync } = require("fs");
const { dirname } = require("path");
const { generateHeapSnapshotForDebugging } = require("bun:jsc");

function cellsThatReach(className) {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = generateHeapSnapshotForDebugging();
  const byId = new Map();
  for (let at = 0; at < nodes.length; at += 7)
    byId.set(nodes[at], { name: nodeClassNames[nodes[at + 2]], size: nodes[at + 1], address: nodes[at + 5], from: [] });
  for (let at = 0; at < edges.length; at += 4) {
    const type = edgeTypes[edges[at + 2]];
    const name =
      type === "Property" || type === "Variable" ? edgeNames[edges[at + 3]] : type === "Index" ? edges[at + 3] : "";
    // A WeakRef holds nothing, and a program that watches an object has one to it.
    if (edges[at] && byId.get(edges[at])?.name !== "WeakRef")
      byId.get(edges[at + 1])?.from.push([edges[at], `${type} ${name}`.trim()]);
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
  // A word that points into a cell counts as well: the size is an estimate, so the report says how far in the word points.
  const cells = [...next.keys()]
    .map(id => ({ start: BigInt(byId.get(id).address), size: BigInt(byId.get(id).size), way: wayFrom(id) }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const cellOf = word => {
    let low = 0;
    for (let high = cells.length; low < high;) {
      const middle = (low + high) >> 1;
      if (cells[middle].start <= word) low = middle + 1;
      else high = middle;
    }
    const cell = cells[low - 1];
    if (!cell || word >= cell.start + (cell.size > 8n ? cell.size : 8n)) return;
    return `0x${word.toString(16)} (${cell.way}${word > cell.start ? `, 0x${(word - cell.start).toString(16)} into the cell` : ""})`;
  };
  return { listed, count: cells.length, cellOf };
}

function wordsOfTheStackOnLinux(cellOf, say) {
  const mappings = readFileSync("/proc/self/maps", "utf8")
    .split("\n")
    .filter(line => line)
    .map(line => {
      const [range, permissions, offset, , , path = ""] = line.split(/ +/);
      const [start, end] = range.split("-").map(text => BigInt("0x" + text));
      return { start, end, permissions, offset: BigInt("0x" + offset), path };
    });
  const stack = mappings.find(({ path }) => path === "[stack]");
  if (!stack) return say("there is no [stack]");
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
    const cell = cellOf(words[index]);
    if (!cell) continue;
    shown++;
    const below = [];
    for (let at = (index - 1) & ~1; at >= 0 && below.length < 3; at -= 2)
      if (isRecord(at)) below.push(`-0x${((index - at) * 8).toString(16)} ${place(words[at + 1])}`);
    const above = [];
    let at = (index + 1) & ~1;
    while (at < words.length - 1 && !isRecord(at)) at += 2;
    for (; at < words.length - 1 && isRecord(at) && above.length < 10; at = Number((words[at] - stack.start) / 8n))
      above.push(`+0x${((at - index) * 8).toString(16)} ${place(words[at + 1])}`);
    say(
      `${cell} lies at 0x${addressOf(index).toString(16)}, 0x${(stack.end - addressOf(index)).toString(16)} below the end of the stack | records below: ${below.join(", ")} | records above, each the caller of the one before: ${above.join(", ")}`,
    );
  }
}

function wordsOfTheStackOnWindows(cellOf, say) {
  const { dlopen, ptr, read, toArrayBuffer } = require("bun:ffi");
  const { symbols: kernel32 } = dlopen("kernel32.dll", {
    GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" },
    RtlCaptureContext: { args: ["ptr"], returns: "void" },
    VirtualQuery: { args: ["u64", "ptr", "u64"], returns: "u64" },
    GetModuleFileNameW: { args: ["u64", "ptr", "u32"], returns: "u32" },
  });
  const lowest = new BigUint64Array(1);
  const highest = new BigUint64Array(1);
  kernel32.GetCurrentThreadStackLimits(lowest, highest);
  // A CONTEXT is 1232 bytes at a multiple of 16, and its stack pointer is at 0x98.
  const storage = new Uint8Array(1232 + 16);
  const skip = (16 - (ptr(storage) % 16)) % 16;
  kernel32.RtlCaptureContext(ptr(storage) + skip);
  const stackPointer = new DataView(storage.buffer).getBigUint64(skip + 0x98, true);
  const start = stackPointer - (stackPointer % 8n);
  const end = highest[0];
  // A copy, taken at once. What this function calls lies in its lowest part.
  const words = new BigUint64Array(toArrayBuffer(Number(start), 0, Number(end - start))).slice();
  const wordAt = address =>
    address >= start && address < end && !(address & 7n) ? words[Number((address - start) >> 3n)] : 0n;

  // The pages that hold an address, where they are in use: [8] is the state, [9] the protection and [10] the type, of 32 bits each.
  const information = new BigUint64Array(6);
  const fields = new Uint32Array(information.buffer);
  const committed = 0x1000;
  const anyExecute = 0xf0;
  const isImage = 0x1000000;
  const pages = new Map();
  const pageAt = address => {
    if (address < 0x10000n || address >= 1n << 47n) return;
    const key = address >> 12n;
    let page = pages.get(key);
    if (page === undefined) {
      page = null;
      if (kernel32.VirtualQuery(address, ptr(information), information.byteLength) && fields[8] === committed)
        page = { allocation: information[1], protection: fields[9], image: fields[10] === isImage };
      pages.set(key, page);
    }
    return page ?? undefined;
  };

  // What the headers of an image say: its file, its size, and its table of functions, which has the start, the end and the unwind
  // information of each as offsets in the image.
  const images = new Map();
  const imageAt = base => {
    let image = images.get(base);
    if (image) return image;
    const at = Number(base);
    image = { base, at, size: 0, path: "", name: "image", functions: new Uint32Array(0) };
    images.set(base, image);
    const headers = at + (read.u16(at, 0) === 0x5a4d ? read.u32(at, 0x3c) : 0);
    // "MZ", "PE", and the optional header of a 64-bit image behind the 24 bytes of the signature and the file header.
    if (headers === at || headers - at > 0x1000 || read.u32(headers, 0) !== 0x4550 || read.u16(headers, 24) !== 0x20b)
      return image;
    image.size = read.u32(headers, 24 + 56);
    const table = read.u32(headers, 24 + 112 + 3 * 8);
    const length = read.u32(headers, 24 + 112 + 3 * 8 + 4);
    if (table && length >= 12) image.functions = new Uint32Array(toArrayBuffer(at + table, 0, length - (length % 12)));
    const path = new Uint16Array(1024);
    image.path = String.fromCharCode(
      ...path.subarray(0, kernel32.GetModuleFileNameW(base, ptr(path), path.length - 1)),
    );
    image.name = image.path.split(/[\\/]/).pop() || "image";
    return image;
  };
  const functionAt = ({ functions }, offset) => {
    for (let low = 0, high = functions.length / 3 - 1; low <= high;) {
      const middle = (low + high) >> 1;
      if (offset < functions[middle * 3]) high = middle - 1;
      else if (offset >= functions[middle * 3 + 1]) low = middle + 1;
      else return middle;
    }
    return -1;
  };

  // An address in code: its place, and the function of its image that holds it. Generated code, the interpreter and what bun:ffi
  // compiles are in no table of functions.
  const addressOfPlace = new Map();
  const codes = new Map();
  const codeAt = address => {
    let code = codes.get(address);
    if (code === undefined) {
      code = null;
      const page = pageAt(address);
      if (page && page.protection & anyExecute) {
        if (page.image) {
          const image = imageAt(page.allocation);
          const offset = Number(address - page.allocation);
          const index = functionAt(image, offset);
          code = { place: `${image.name}+0x${offset.toString(16)}`, image, function: index < 0 ? undefined : index };
        } else code = { place: `generated code at 0x${address.toString(16)}` };
        addressOfPlace.set(code.place, address);
      }
      codes.set(address, code);
    }
    return code ?? undefined;
  };

  // The caller of a function that waits for a call to return: its stack pointer, its frame pointer and where it goes on. The unwind
  // codes of the function say what its prologue pushed and took from the stack, the last first. `saved` gets where each register lies.
  const registers = "rax rcx rdx rbx rsp rbp rsi rdi r8 r9 r10 r11 r12 r13 r14 r15".split(" ");
  const callerOf = (image, index, rsp, rbp, saved) => {
    let base;
    let at = image.functions[index * 3 + 2];
    for (let followed = 0; followed < 16; followed++) {
      // An odd offset is that of another entry of the table.
      if (at & 1) {
        at = read.u32(image.at + at - 1, 8);
        continue;
      }
      const unwind = image.at + at;
      const versionAndFlags = read.u8(unwind, 0);
      const count = read.u8(unwind, 2);
      const frame = read.u8(unwind, 3);
      const version = versionAndFlags & 7;
      // Only rbp is followed as a frame pointer.
      if ((version !== 1 && version !== 2) || (frame & 15 && (frame & 15) !== 5)) return;
      const fromFramePointer = BigInt((frame >> 4) * 16);
      base ??= frame & 15 ? rbp - fromFramePointer : rsp;
      for (let code = 0; code < count; code++) {
        const byte = read.u8(unwind, 5 + code * 2);
        const operation = byte & 15;
        const value = byte >> 4;
        if (operation === 0) {
          // A register was pushed.
          saved.push([rsp, registers[value]]);
          if (value === 5) rbp = wordAt(rsp);
          rsp += 8n;
        } else if (operation === 1) {
          // A large part of the stack was taken: its size is in the next one or two codes.
          rsp += BigInt(value ? read.u32(unwind, 6 + code * 2) : read.u16(unwind, 6 + code * 2) * 8);
          code += value ? 2 : 1;
        } else if (operation === 2) rsp += BigInt(value * 8 + 8);
        else if (operation === 3) rsp = rbp - fromFramePointer;
        else if (operation === 4 || operation === 5) {
          // A register was stored in the frame.
          const slot =
            base + BigInt(operation === 4 ? read.u16(unwind, 6 + code * 2) * 8 : read.u32(unwind, 6 + code * 2));
          saved.push([slot, registers[value]]);
          if (value === 5) rbp = wordAt(slot);
          code += operation === 4 ? 1 : 2;
        } else if (operation === 6 || operation === 8) code += 1;
        else if (operation === 7 || operation === 9) code += 2;
        else return;
      }
      // The unwind information of a part of a function goes on with that of the function.
      if (!(versionAndFlags & 0x20))
        return rsp >= start && rsp < end ? { rip: wordAt(rsp), rsp: rsp + 8n, rbp } : undefined;
      at = read.u32(unwind + 4 + ((count + 1) & ~1) * 2, 8);
    }
  };

  // The frames from a frame record upwards, each the caller of the one before. A frame record is the frame pointer of the caller
  // and, above it, the return address. Code that is in no table of functions keeps one.
  const framesFrom = record => {
    const frames = [];
    let rip = wordAt(record + 8n);
    let rsp = record + 16n;
    let rbp = wordAt(record);
    while (frames.length < 1024) {
      const code = codeAt(rip);
      if (!code) break;
      const frame = { place: code.place, from: rsp, saved: [] };
      if (code.function === undefined) {
        if (rbp < rsp || rbp >= end || rbp & 7n) break;
        [rip, rsp, rbp] = [wordAt(rbp + 8n), rbp + 16n, wordAt(rbp)];
      } else {
        const caller = callerOf(code.image, code.function, rsp, rbp, frame.saved);
        if (!caller) break;
        ({ rip, rsp, rbp } = caller);
      }
      frame.to = rsp;
      frames.push(frame);
    }
    return { frames, stopped: rsp, at: rip };
  };
  // The lowest record whose callers go up to the start of the thread, which is in the last page of the stack. Below that record lies
  // what this function left. Where no record gets that far, the one that gets furthest stands for it.
  const hex = value => `0x${value.toString(16)}`;
  let live;
  for (let record = start, tried = 0; record < end && tried < 256; record += 8n) {
    if (wordAt(record) <= record || !codeAt(wordAt(record + 8n))) continue;
    tried++;
    const found = framesFrom(record);
    if (!live || found.stopped > live.stopped) live = found;
    if (end - found.stopped < 0x1000n) break;
  }
  const frames = live?.frames ?? [];
  if (!live || end - live.stopped >= 0x1000n)
    say(
      `the frames were followed from ${hex(end - (frames[0]?.from ?? end))} to ${hex(end - (live?.stopped ?? end))} below the end of the stack, where ${hex(live?.at ?? 0n)} is no code with a frame that can be undone`,
    );

  const mentioned = new Set();
  let shown = 0;
  for (let index = words.length - 1; index >= 0 && shown < 16; index--) {
    const cell = cellOf(words[index]);
    if (!cell) continue;
    shown++;
    const address = start + BigInt(index) * 8n;
    let where;
    const owner = frames.findIndex(({ from, to }) => from <= address && address < to);
    if (owner >= 0) {
      const { place, from } = frames[owner];
      // A function may store a register in the 32 bytes that its caller keeps free for it, above its own return address.
      const saver = frames.find(({ saved }) => saved.some(([slot]) => slot === address));
      const register = saver?.saved.find(([slot]) => slot === address)[1];
      const callers = frames.slice(owner + 1, owner + 11).map(({ place }) => place);
      for (const each of [place, ...callers]) mentioned.add(each);
      if (saver) mentioned.add(saver.place);
      where = `in the frame of ${place}, ${hex(address - from)} above its stack pointer${saver ? `, where ${saver === frames[owner] ? "it" : saver.place} saved ${register}` : ""} | called from, each the caller of the one before: ${callers.join(", ")}`;
    } else {
      const near = [];
      for (let at = Math.max(0, index - 96); at < Math.min(words.length, index + 384); at++) {
        const code = at !== index && codeAt(words[at]);
        if (!code?.image) continue;
        mentioned.add(code.place);
        near.push(`${at < index ? "-" : "+"}${hex(Math.abs(at - index) * 8)} ${code.place}`);
      }
      where = `in no frame that was found | words of an image around it: ${near.join(", ")}`;
    }
    say(`${cell} lies at ${hex(address)}, ${hex(end - address)} below the end of the stack | ${where}`);
  }
  if (!shown)
    return say(`no word of the stack has such an address: ${hex(end - start)} bytes from the stack pointer up`);

  // The names, last: the symbols of the executable are large, and a system library without symbols has its exports.
  const { symbols: dbghelp } = dlopen("dbghelp.dll", {
    SymSetOptions: { args: ["u32"], returns: "u32" },
    SymInitializeW: { args: ["u64", "ptr", "i32"], returns: "i32" },
    SymLoadModuleExW: { args: ["u64", "u64", "ptr", "ptr", "u64", "u32", "ptr", "u32"], returns: "u64" },
    SymFromAddr: { args: ["u64", "u64", "ptr", "ptr"], returns: "i32" },
  });
  const wide = text => Uint16Array.from({ length: text.length + 1 }, (_, index) => text.charCodeAt(index) || 0);
  // Not the handle of this process: the images are given one by one, and dbghelp reads their files.
  const session = 0x6b656570n;
  const undecorated = 0x2;
  const noPrompts = 0x80000;
  const failCriticalErrors = 0x200;
  dbghelp.SymSetOptions(undecorated | noPrompts | failCriticalErrors);
  if (!dbghelp.SymInitializeW(session, wide(dirname(process.execPath)), 0))
    return say("dbghelp.dll did not start, so the places have no names");
  // A SYMBOL_INFO is 88 bytes, with its own size first, the length of the name at 76, the room for it at 80 and the name from 84.
  const symbol = new Uint8Array(88 + 1024);
  const symbolView = new DataView(symbol.buffer);
  const displacement = new BigUint64Array(1);
  const loaded = new Set();
  for (const place of mentioned) {
    const address = addressOfPlace.get(place);
    const image = codes.get(address)?.image;
    if (!image?.path) continue;
    if (!loaded.has(image)) {
      loaded.add(image);
      dbghelp.SymLoadModuleExW(session, 0n, wide(image.path), null, image.base, image.size, null, 0);
    }
    symbol.fill(0);
    symbolView.setUint32(0, 88, true);
    symbolView.setUint32(80, 1024, true);
    if (!dbghelp.SymFromAddr(session, address, displacement, symbol)) continue;
    const name = Buffer.from(symbol.buffer, 84, Math.min(symbolView.getUint32(76, true), 1023)).toString("latin1");
    say(`${place} is ${name}+${hex(displacement[0])}`);
  }
}

function whatKeepsAlive(className, say) {
  const lines = [];
  say ??= line => lines.push(line);
  const { listed, count, cellOf } = cellsThatReach(className);
  say(`${count} cells reach a ${className}`);
  listed.forEach(line => say(line));
  try {
    if (process.platform === "linux") wordsOfTheStackOnLinux(cellOf, say);
    else if (process.platform === "win32" && process.arch === "x64") wordsOfTheStackOnWindows(cellOf, say);
    else say("the stack is read on Linux and on Windows x64 only");
  } catch (error) {
    say(`the stack was not read: ${error}`);
  }
  return lines.join("\n");
}

module.exports = { whatKeepsAlive };
