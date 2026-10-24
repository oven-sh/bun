import net from "node:net";

export const upgradeHeaders = [
  "Connection: Upgrade",
  "Upgrade: websocket",
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version: 13",
];

/** Host values that Bun.serve cannot build `request.url` from. */
export const unusableHosts = [
  "a b",
  "evil.example@localhost",
  "localhost/evil",
  "localhost#x",
  "localhost?x",
  "localhost\\x",
  "[::1",
  // Node's inspector serves this Host: TrimPort() cuts at the last ":" and does not check the port.
  // https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket.cc#L161-L169
  "localhost:abc",
];

export type RawResponse = { status: string; body: unknown };

/**
 * Sends one request over a raw socket. fetch() always sends HTTP/1.1 with a Host header, and
 * the HTTP parser refuses an HTTP/1.1 request that has no Host header.
 */
export function rawRequest(address: net.NetConnectOpts, requestLine: string, headers: string[] = []) {
  const { promise, resolve, reject } = Promise.withResolvers<RawResponse>();
  const isUpgrade = headers.includes("Upgrade: websocket");
  let response = "";
  const socket = net.connect(address, () => socket.write([requestLine, ...headers, "", ""].join("\r\n")));
  socket.on("data", chunk => {
    response += chunk;
    const headerEnd = response.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    // The server keeps the socket open after an upgrade response, accepted or not.
    const length = /^content-length: (\d+)$/im.exec(response.slice(0, headerEnd));
    if (isUpgrade || (length && response.length - headerEnd - 4 >= Number(length[1]))) socket.destroy();
  });
  socket.on("error", reject);
  socket.on("close", () => {
    const status = response.slice(0, response.indexOf("\r\n"));
    let body: unknown = isUpgrade ? "" : response.slice(response.indexOf("\r\n\r\n") + 4);
    try {
      body = JSON.parse(body as string);
    } catch {
      // Keep a large error page out of the assertion output.
      if ((body as string).length > 200) body = `<${(body as string).length} bytes>`;
    }
    resolve({ status, body });
  });
  return promise;
}

/** Sends `GET target` and a WebSocket upgrade of `upgradePath` with each unusable Host. */
export async function requestWithUnusableHosts(address: net.NetConnectOpts, target: string, upgradePath: string) {
  const answers: Record<string, { get: RawResponse; upgrade: RawResponse }> = {};
  for (const host of unusableHosts) {
    answers[host] = {
      get: await rawRequest(address, `GET ${target} HTTP/1.1`, [`Host: ${host}`, "Connection: close"]),
      upgrade: await rawRequest(address, `GET ${upgradePath} HTTP/1.1`, [`Host: ${host}`, ...upgradeHeaders]),
    };
  }
  return answers;
}
