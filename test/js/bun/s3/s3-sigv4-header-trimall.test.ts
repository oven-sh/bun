import { describe, test, expect } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import net from "node:net";

// Fake credentials from the AWS SigV4 documentation examples.
const ACCESS = "AKIDEXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

// AWS SigV4 CanonicalHeaders "Trimall" on the received header value.
const trimall = (v: string) => v.trim().replace(/\s+/g, " ");

// A minimal SigV4-verifying S3 origin. It rebuilds the canonical request from
// the received headers the way a conforming backend does (applying Trimall to
// every signed header value) and compares the resulting signature to the one
// the client sent in Authorization.
function createSigV4Origin(sockets: Set<net.Socket>) {
  return net.createServer(sock => {
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    let done = false;
    sock.on("error", () => {});
    sock.on("close", () => sockets.delete(sock));
    sock.on("data", d => {
      buf = Buffer.concat([buf, d]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0 || done) return;
      const head = buf.subarray(0, headerEnd).toString("latin1");
      const lines = head.split("\r\n");
      const [method, target] = lines[0].split(" ");
      const h: Record<string, string> = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(":");
        if (i > 0) h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim();
      }
      const bodyLen = Number(h["content-length"] || "0");
      if (buf.length - headerEnd - 4 < bodyLen) return;
      done = true;
      const m =
        /Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})/.exec(
          h.authorization || "",
        );
      let status = 400;
      if (m) {
        const [path, query = ""] = target.split("?");
        const signed = m[5].split(";");
        const canon = [
          method,
          path,
          query,
          signed.map(n => n + ":" + trimall(h[n] ?? "") + "\n").join(""),
          m[5],
          h["x-amz-content-sha256"],
        ].join("\n");
        const sts =
          `AWS4-HMAC-SHA256\n${h["x-amz-date"]}\n${m[2]}/${m[3]}/${m[4]}/aws4_request\n` +
          createHash("sha256").update(Buffer.from(canon, "latin1")).digest("hex");
        let k = createHmac("sha256", "AWS4" + SECRET).update(m[2]).digest();
        for (const p of [m[3], m[4], "aws4_request"]) k = createHmac("sha256", k).update(p).digest();
        status = createHmac("sha256", k).update(sts).digest("hex") === m[6] ? 200 : 403;
      }
      const body =
        status === 200 ? "" : "<Error><Code>SignatureDoesNotMatch</Code><Message>sig</Message></Error>";
      sock.write(`HTTP/1.1 ${status} X\r\nContent-Length: ${body.length}\r\nETag: "e"\r\n\r\n${body}`);
    });
  });
}

describe("S3 SigV4 signed header Trimall", () => {
  async function run(opts: Bun.S3Options, ctor: Bun.S3Options = {}) {
    const sockets = new Set<net.Socket>();
    const server = createSigV4Origin(sockets);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const s3 = new Bun.S3Client({
        endpoint: `http://127.0.0.1:${port}`,
        bucket: "b",
        accessKeyId: ACCESS,
        secretAccessKey: SECRET,
        region: "us-east-1",
        ...ctor,
      });
      await s3.write("obj", "x", opts);
      return "ok";
    } catch (e: any) {
      return e?.code ?? String(e);
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  }

  test("control: single-space value matches", async () => {
    expect(await run({ contentDisposition: 'attachment; filename="a b.txt"' })).toBe("ok");
  });

  test("contentDisposition with interior run of spaces", async () => {
    expect(await run({ contentDisposition: 'attachment;  filename="a  b.txt"' })).toBe("ok");
  });

  test("contentDisposition with leading and trailing whitespace", async () => {
    expect(await run({ contentDisposition: "  inline  " })).toBe("ok");
  });

  test("contentEncoding with trailing whitespace", async () => {
    expect(await run({ contentEncoding: "gzip  " })).toBe("ok");
  });

  test("sessionToken with trailing whitespace", async () => {
    expect(await run({}, { sessionToken: "TOK123abc+/= " })).toBe("ok");
  });

  test("contentEncoding with interior tab", async () => {
    expect(await run({ contentEncoding: "gzip,\tbr" })).toBe("ok");
  });
});
