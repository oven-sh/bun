// A chunk lies in a stream that has not begun to flow, and its memory goes away: the buffer is transferred, or the WebAssembly memory under it grows.
// The stream still counts the four bytes that it took in. As node does, it hands out nothing and does not end.
import { expect, test } from "bun:test";
import { Readable } from "node:stream";

const transfer = (bytes: Buffer): void => {
  structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] });
};
const fresh = (): Buffer => Buffer.from(new ArrayBuffer(4));

async function flowing(bytes: Buffer, ends: boolean, change: (bytes: Buffer) => void): Promise<string> {
  const readable = new Readable({ read() {} });
  const told: string[] = [];
  readable.push(bytes);
  if (ends) readable.push(null);
  change(bytes);
  readable.on("data", chunk => told.push("data " + chunk.length));
  readable.on("end", () => told.push("end"));
  readable.on("close", () => told.push("close"));
  readable.on("error", error => told.push("error " + error.name));
  await new Promise(resolve => setTimeout(resolve, 60));
  return `${told.join(" ") || "nothing"} | ${readable.readableLength} ${readable.readableFlowing}`;
}

test.each([false, true])("a stream that flows over a chunk without memory, ended: %p", async ends => {
  expect(await flowing(fresh(), ends, () => {})).toBe(ends ? "data 4 end close | 0 true" : "data 4 | 0 true");
  expect(await flowing(fresh(), ends, transfer)).toBe("nothing | 4 true");
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const overMemory = Buffer.from(memory.buffer as ArrayBuffer, 8, 4);
  expect(await flowing(overMemory, ends, () => void memory.grow(1))).toBe("nothing | 4 true");
});
