// HEAD requests for a Response whose body is an S3-backed Blob. A local server
// plays the S3 endpoint. serve-s3-blob-body-head.test.ts runs this in a
// subprocess, so a crash of the server shows up as an exit code.
//
//   gc      one HEAD, with a full GC while the server still works on it
//   matrix  one HEAD for every way such a Response reaches the server

const mode = process.argv[2];

const s3Requests: string[] = [];
const { promise: s3Asked, resolve: onS3Asked } = Promise.withResolvers<void>();
const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();

using s3Origin = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const range = req.headers.get("range");
    s3Requests.push(range ? `${req.method} ${range}` : req.method);
    onS3Asked();
    if (mode === "gc") await gate;
    return new Response("0123456789");
  },
});
const s3 = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
  bucket: "my-bucket",
  endpoint: s3Origin.url.href,
});
// Each Response gets an S3File of its own.
const object = () => s3.file("object.txt");

if (mode === "gc") {
  using app = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => fetch(URL.createObjectURL(object())),
  });
  const head = fetch(app.url, { method: "HEAD" });
  // A server that asks S3 about this HEAD is between the handler and the
  // response here. Nothing in the script holds the Response any more.
  await Promise.race([s3Asked, head]);
  Bun.gc(true);
  openGate();
  const res = await head;
  console.log(JSON.stringify({ status: res.status, contentLength: res.headers.get("content-length"), s3Requests }));
} else {
  const producers: Record<string, () => Promise<Response>> = {
    "fetch(blob:)": () => fetch(URL.createObjectURL(object())),
    "clone()": async () => (await fetch(URL.createObjectURL(object()))).clone(),
    "new Response([s3file])": async () => new Response([object()]),
  };
  const fail = () => {
    throw new Error("handler failed");
  };
  const entries: Record<string, (res: Response) => object> = {
    "returned": res => ({ fetch: () => res }),
    "fulfilled promise": res => ({ fetch: () => Promise.resolve(res) }),
    "pending promise": res => ({ fetch: () => new Promise(resolve => setImmediate(resolve, res)) }),
    "error()": res => ({ fetch: fail, error: () => res }),
    "error() fulfilled promise": res => ({ fetch: fail, error: () => Promise.resolve(res) }),
    "routes GET": res => ({ routes: { "/": { GET: () => res } } }),
  };

  for (const [producer, produce] of Object.entries(producers)) {
    for (const [entry, options] of Object.entries(entries)) {
      const res = await produce();
      using app = Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, ...options(res) } as any);
      const asked = s3Requests.length;
      const head = await fetch(app.url, { method: "HEAD" });
      const askedForHead = s3Requests.slice(asked);
      const bodyUsed = res.bodyUsed;
      // HEAD writes no size into the Response's blob, so a read of the body
      // still asks S3 for the whole object.
      const body = await res.text();
      console.log(
        JSON.stringify({
          producer,
          entry,
          status: head.status,
          contentLength: head.headers.get("content-length"),
          transferEncoding: head.headers.get("transfer-encoding"),
          s3Requests: askedForHead,
          bodyUsed,
          body,
          s3RequestsForBody: s3Requests.slice(asked + askedForHead.length),
        }),
      );
    }
  }
}
