// Prints, for each size in argv, what Bun.serve made of a compressed message of that many spaces: its length, or "refused".
// The message's DEFLATE stream uses length symbol 286, which tells who inflated it. The one-shot inflater takes it for a
// length of 258, as libdeflate did. zlib refuses it.
import { RawClient } from "../../web/websocket/raw-peer";

function compressedSpaces(size: number): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  const put = (value: number, length: number) => {
    bits |= value << count;
    for (count += length; count >= 8; count -= 8, bits >>>= 8) bytes.push(bits & 255);
  };
  // Huffman codes go most significant bit first.
  const putCode = (code: number, length: number) => {
    while (length-- > 0) put((code >> length) & 1, 1);
  };
  const putMatchOf258AtDistance1 = (lengthSymbol: 285 | 286) => {
    putCode(0xc0 + lengthSymbol - 280, 8);
    putCode(0, 5);
  };
  const putSpace = () => putCode(0x30 + 0x20, 8);

  // A block of the static codes that is not the last.
  put(0b010, 3);
  putSpace();
  putMatchOf258AtDistance1(286);
  let left = size - 259;
  for (; left >= 258; left -= 258) putMatchOf258AtDistance1(285);
  for (; left > 0; left--) putSpace();
  putCode(0, 7);
  // The start of the empty stored block whose 00 00 ff ff the receiver adds.
  put(0, 3);
  put(0, 7);
  return Buffer.from(bytes);
}

using server = Bun.serve({
  port: 0,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    perMessageDeflate: true,
    message(ws, message) {
      ws.send(String(message.length), false);
    },
  },
});

const results: Record<string, string> = {};
for (const size of process.argv.slice(2)) {
  const client = await RawClient.upgrade(server.port, {
    headers: { "Sec-WebSocket-Extensions": "permessage-deflate" },
  });
  client.text(compressedSpaces(Number(size)), { rsv1: true });
  const frame = await client.nextFrame();
  results[size] = frame?.opcode === 1 ? frame.payload.toString() : "refused";
  client.destroy();
}
console.log(JSON.stringify(results));
