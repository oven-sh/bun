// The first request of each kind is slow in a debug build of Bun, which runs
// the server in the interpreter. A program that starts the server for other
// programs sends these requests to a second server before it reports that it
// is ready.

import { SigningClient, type RequestOptions } from "./client.ts";
import { serve } from "./server.ts";

const BUCKET = "warm-up";

/** Does the common operations one time on a server of its own. */
export async function warmUp(): Promise<void> {
  await using server = serve({ buckets: [BUCKET] });
  const client = new SigningClient({ endpoint: server.url, ...server.credentials });
  const send = (method: string, key: string, options: RequestOptions = {}) =>
    client.fetch(method, `/${BUCKET}/${key}`, { payload: "unsigned", ...options });

  await send("PUT", "object", { body: "data" });
  await send("HEAD", "object");
  await (await send("GET", "object", { headers: { range: "bytes=0-1" } })).text();
  await (await send("GET", "", { query: { "list-type": "2" } })).text();
  await (await send("GET", "missing")).text();

  const created = await send("POST", "parts", { query: { uploads: "" } });
  const uploadId = /<UploadId>([^<]+)</.exec(await created.text())?.[1] ?? "";
  const part = await send("PUT", "parts", { query: { partNumber: "1", uploadId }, body: "data" });
  const parts = `<Part><PartNumber>1</PartNumber><ETag>${part.headers.get("etag")}</ETag></Part>`;
  const complete = `<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`;
  await (await send("POST", "parts", { query: { uploadId }, body: complete })).text();
  await send("DELETE", "parts");
}
