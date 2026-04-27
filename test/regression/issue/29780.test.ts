// https://github.com/oven-sh/bun/issues/29780
//
// Bun's fetch HTTP client used to enable ECH GREASE (encrypted_client_hello
// extension, type 0xfe0d, RFC 9460/9180 draft) on every TLS ClientHello.
// That extension carries ~200-300 bytes of random-looking payload that some
// servers and middleboxes treat as hostile: the TCP + TLS handshake completes,
// the request bytes arrive, but the server silently holds the connection open
// without responding. curl, Node's undici, and Bun's own node:tls all omit
// ECH GREASE, so our fetch was the outlier.
//
// Regression surfaced in 1.3.13 after the BoringSSL upgrade — reporter
// observed node:tls against the same host worked on the same Bun process.
//
// This verifies fetch's ClientHello no longer advertises extension 0xfe0d.
import { expect, test } from "bun:test";
import net from "node:net";

// Parses a TLS ClientHello out of a raw TCP byte stream and returns the
// list of extension type IDs it advertises. See RFC 8446 §4.1.2.
function parseClientHelloExtensions(bytes: Buffer): number[] | null {
  // TLSPlaintext: type(1) legacy_version(2) length(2) = 5 bytes
  if (bytes.length < 5 || bytes[0] !== 0x16) return null; // 0x16 = handshake
  const recordLen = bytes.readUInt16BE(3);
  if (bytes.length < 5 + recordLen) return null;
  // Handshake: msg_type(1) length(3) = 4 bytes, then ClientHello
  let p = 5;
  if (bytes[p] !== 0x01) return null; // 0x01 = client_hello
  p += 4;
  p += 2; // legacy_version
  p += 32; // random
  const sessionIdLen = bytes[p];
  p += 1 + sessionIdLen;
  const cipherSuitesLen = bytes.readUInt16BE(p);
  p += 2 + cipherSuitesLen;
  const compressionLen = bytes[p];
  p += 1 + compressionLen;
  if (p + 2 > bytes.length) return [];
  const extensionsLen = bytes.readUInt16BE(p);
  p += 2;
  const extensionsEnd = p + extensionsLen;
  const types: number[] = [];
  while (p + 4 <= extensionsEnd) {
    const extType = bytes.readUInt16BE(p);
    const extLen = bytes.readUInt16BE(p + 2);
    types.push(extType);
    p += 4 + extLen;
  }
  return types;
}

test("fetch TLS ClientHello does not include ECH GREASE extension", async () => {
  const { promise: helloPromise, resolve: resolveHello } = Promise.withResolvers<Buffer>();

  await using server = net.createServer(socket => {
    const chunks: Buffer[] = [];
    socket.on("data", chunk => {
      chunks.push(chunk);
      // The ClientHello arrives in the first record; capture it and close
      // so fetch rejects quickly instead of hanging on TLS.
      resolveHello(Buffer.concat(chunks));
      socket.destroy();
    });
    socket.on("error", () => {});
  });

  const { promise: listening, resolve: onListen } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => onListen());
  await listening;
  const port = (server.address() as net.AddressInfo).port;

  // fetch will fail (the server just drops the connection) — we only care
  // about the ClientHello bytes it sent.
  await fetch(`https://127.0.0.1:${port}/`, {
    tls: { rejectUnauthorized: false },
  }).catch(() => {});

  const hello = await helloPromise;
  const extensions = parseClientHelloExtensions(hello);
  expect(extensions).not.toBeNull();
  // 0xfe0d = encrypted_client_hello (ECH). Must be absent.
  expect(extensions).not.toContain(0xfe0d);
  // Sanity: ALPN (16) should be present so we know the parser actually
  // walked the extensions list. SNI (0) is intentionally omitted because
  // the request targets an IP literal — see RFC 6066 §3.
  expect(extensions).toContain(16); // application_layer_protocol_negotiation
});
