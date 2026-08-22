import { createHash, createHmac } from "node:crypto";
import net from "node:net";

const ACCESS = "AKIDEXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const trimall = (v: string) => v.replace(/^[ \t]+|[ \t]+$/g, "").replace(/[ \t]+/g, " ");

// A minimal SigV4-verifying S3 origin. It rebuilds the canonical request from
// the received headers the way a conforming backend does (applying Trimall to
// every signed header value) and compares the resulting signature to the one
// the client sent in Authorization.
let lastRawHeaders = "";
const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("error", () => {});
  sock.on("data", d => {
    buf = Buffer.concat([buf, d]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const head = buf.subarray(0, headerEnd).toString("latin1");
      lastRawHeaders = head;
      const lines = head.split("\r\n");
      const [method, target] = lines[0].split(" ");
      const h: Record<string, string> = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(":");
        if (i > 0) h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim();
      }
      const bodyLen = Number(h["content-length"] || "0");
      const reqLen = headerEnd + 4 + bodyLen;
      if (buf.length < reqLen) return;
      buf = buf.subarray(reqLen);
      const m =
        /Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})/.exec(
          h.authorization || "",
        );
      let status = 400;
      if (m) {
        const [path, query = ""] = target.split("?");
        const canon = [
          method,
          path,
          query,
          m[5]
            .split(";")
            .map(n => n + ":" + trimall(h[n] ?? "") + "\n")
            .join(""),
          m[5],
          h["x-amz-content-sha256"],
        ].join("\n");
        const scope = m[2] + "/" + m[3] + "/" + m[4] + "/aws4_request";
        const sts =
          "AWS4-HMAC-SHA256\n" +
          h["x-amz-date"] +
          "\n" +
          scope +
          "\n" +
          createHash("sha256").update(Buffer.from(canon, "latin1")).digest("hex");
        let k = createHmac("sha256", "AWS4" + SECRET)
          .update(m[2])
          .digest();
        for (const p of [m[3], m[4], "aws4_request"]) k = createHmac("sha256", k).update(p).digest();
        status = createHmac("sha256", k).update(sts).digest("hex") === m[6] ? 200 : 403;
      }
      const body = status === 200 ? "" : "<Error><Code>SignatureDoesNotMatch</Code><Message>sig</Message></Error>";
      sock.write("HTTP/1.1 " + status + " X\r\nContent-Length: " + body.length + '\r\nETag: "e"\r\n\r\n' + body);
    }
  });
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const port = (server.address() as net.AddressInfo).port;

async function run(opts: Bun.S3Options, ctor: Bun.S3Options = {}) {
  const s3 = new Bun.S3Client({
    endpoint: "http://127.0.0.1:" + port,
    bucket: "b",
    accessKeyId: ACCESS,
    secretAccessKey: SECRET,
    region: "us-east-1",
    ...ctor,
  });
  try {
    await s3.write("obj", "x", opts);
    return "ok";
  } catch (e: any) {
    return e?.code ?? String(e);
  }
}

const cd_run = await run({ contentDisposition: 'attachment;  filename="a  b.txt"' });
// Trimall affects only the canonical request; the raw interior whitespace goes on the wire.
const cd_run_wire = lastRawHeaders.includes('content-disposition: attachment;  filename="a  b.txt"');

const results = {
  control: await run({ contentDisposition: 'attachment; filename="a b.txt"' }),
  cd_run,
  cd_run_wire,
  cd_outer: await run({ contentDisposition: "  inline  " }),
  ce_trailing: await run({ contentEncoding: "gzip  " }),
  token_trailing: await run({}, { sessionToken: "TOK123abc+/= " }),
  ce_tab: await run({ contentEncoding: "gzip,\tbr" }),
};
console.log(JSON.stringify(results));
process.exit(0);
