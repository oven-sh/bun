import { S3Client } from "bun";

/**
 * A local stand-in for an S3 endpoint that holds one object, under the key "key".
 * It records the Range header of each request. It answers a Range request like a
 * server that clamps the end of the range to the end of the object.
 */
export function s3LocalEndpoint(object: string | Uint8Array) {
  const bytes = Buffer.from(object);
  const ranges: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const range = req.headers.get("range");
      ranges.push(range);
      const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response(bytes);
      const start = Number(match[1]);
      const end = match[2] === "" ? bytes.length - 1 : Math.min(Number(match[2]), bytes.length - 1);
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
      });
    },
  });
  const client = new S3Client({ endpoint: server.url.href, accessKeyId: "x", secretAccessKey: "y", bucket: "b" });
  return {
    /** The Range header of each request so far. `null` is a request with no Range header. */
    ranges,
    file: (type?: string) => client.file("key", { type }),
    [Symbol.dispose]: () => void server.stop(true),
  };
}
