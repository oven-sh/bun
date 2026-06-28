// Spawned by s3-error-codes.test.ts. Runs every S3 operation against local
// mock servers that answer with error statuses, and prints the observed error
// codes/messages as a single JSON object on stdout.
import { S3Client, type S3Options } from "bun";

const baseOptions = {
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
} satisfies Omit<S3Options, "endpoint">;

function options(endpoint: string): S3Options {
  return { ...baseOptions, endpoint };
}

function serve(fetch: (req: Request) => Response) {
  return Bun.serve({ port: 0, fetch });
}

/** Resolve to the rejection's `code`, or a sentinel if the promise resolved. */
async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return "<resolved>";
  } catch (error: any) {
    return error?.code;
  }
}

/** Resolve to the rejection's `{ code, message }`, or a sentinel if it resolved. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return "<resolved>";
  } catch (error: any) {
    return { code: error?.code, message: error?.message };
  }
}

const results: Record<string, unknown> = {};

// A failed HEAD response has no body (HTTP forbids a body on HEAD), so both the
// code and the message can only come from the status. 418 has no canonical code.
for (const status of [403, 404, 405, 411, 412, 416, 418, 500, 501, 503]) {
  using server = serve(() => new Response(null, { status }));
  results[`stat ${status}`] = await errorOf(S3Client.file("key", options(server.url.href)).stat());
}

// Every operation routes its errors through the same status fallback.
{
  using server = serve(() => new Response(null, { status: 403 }));
  const opts = options(server.url.href);
  results["exists 403"] = await codeOf(S3Client.file("key", opts).exists());
  results["text 403"] = await codeOf(S3Client.file("key", opts).text());
  results["stream 403"] = await codeOf(new Response(S3Client.file("key", opts).stream()).text());
  results["write 403"] = await codeOf(S3Client.file("key", opts).write("data"));
  results["delete 403"] = await codeOf(S3Client.file("key", opts).delete());
  results["list 403"] = await codeOf(new S3Client(opts).list());
}

// An XML <Code> in the response body takes precedence over the status mapping.
{
  using server = serve(
    () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>`,
        { status: 403 },
      ),
  );
  results["text 403 with xml body"] = await errorOf(S3Client.file("key", options(server.url.href)).text());
}

// A non-XML error body (e.g. a load balancer's plain-text error page) is the
// only diagnostic the server sent: keep it as the message, and take only the
// code from the status.
{
  const body = "upstream connect error or disconnect/reset before headers";
  using server = serve(() => new Response(body, { status: 503 }));
  results["text 503 with text body"] = await errorOf(S3Client.file("key", options(server.url.href)).text());
}

// exists() must keep distinguishing "not there" (false) from "not allowed" (reject).
{
  using server = serve(() => new Response(null, { status: 404 }));
  results["exists 404"] = await S3Client.file("key", options(server.url.href)).exists();
}

console.log(JSON.stringify(results));
