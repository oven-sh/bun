import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as crypto from "node:crypto";
import * as net from "node:net";

const PROTOCOL = "v1.kernel.websocket.jupyter.org";
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

test("WebSocket.protocol should not mutate after receiving frames", async () => {
  // Raw TCP server that negotiates a WebSocket subprotocol, then sends a
  // binary frame whose payload is large enough to overwrite the protocol
  // string in the HTTP upgrade response buffer.
  const payload = Buffer.alloc(178, "A");
  const frameHeader = Buffer.from([0x82, 0x7e, 0x00, 0xb2]); // FIN + binary, len=178

  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    let upgraded = false;
    socket.on("error", () => {});
    socket.on("data", chunk => {
      if (upgraded) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;

      const req = buf.subarray(0, end + 4).toString("latin1");
      const key = req.match(/Sec-WebSocket-Key: (.*)\r\n/i)?.[1]?.trim();
      if (!key) return socket.destroy();

      const accept = crypto
        .createHash("sha1")
        .update(key + GUID)
        .digest("base64");

      const response =
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        `Sec-WebSocket-Protocol: ${PROTOCOL}\r\n` +
        "\r\n";

      upgraded = true;
      socket.write(response);
      socket.write(frameHeader);
      socket.write(payload);
    });
  });

  const { promise: listening, resolve: resolveListening } = Promise.withResolvers<number>();
  server.listen(0, "127.0.0.1", () => {
    resolveListening((server.address() as net.AddressInfo).port);
  });

  const port = await listening;

  try {
    // Spawn the client as a child process. The buffer aliasing bug only
    // manifests when the WebSocket client reads frames into the same buffer
    // that held the HTTP upgrade response, which requires going through
    // the full network path (not an in-process WebSocket).
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const PROTOCOL = "v1.kernel.websocket.jupyter.org";
const result = await new Promise((resolve, reject) => {
  const ws = new WebSocket("ws://127.0.0.1:${port}", PROTOCOL);
  let openProtocol = "";
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { openProtocol = ws.protocol; };
  ws.onerror = () => reject(new Error("websocket error"));
  ws.onmessage = () => {
    resolve({ openProtocol, liveProtocol: ws.protocol });
    ws.close();
  };
});
console.log(JSON.stringify(result));
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      throw new Error(`Child process exited with code ${exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`);
    }

    const result = JSON.parse(stdout.trim());
    expect(result.openProtocol).toBe(PROTOCOL);
    expect(result.liveProtocol).toBe(PROTOCOL);
  } finally {
    server.close();
  }
});
