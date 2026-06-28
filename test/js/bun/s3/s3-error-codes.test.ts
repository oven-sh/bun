import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// S3 cannot include an XML error document in a HEAD response (HTTP forbids a
// body on HEAD), so the error code for a failed stat()/exists() has to come
// from the HTTP status. It previously always collapsed into "UnknownError".
// The status -> code table follows
// https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
test("S3 error code is derived from the HTTP status when the error response has no body", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "s3-error-codes-fixture.ts")],
    // The fixture talks to its own local mock servers. Strip the proxy env so
    // an egress proxy on the host cannot intercept those requests.
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If the fixture crashed before printing, surface its output in the diff.
  const results = stdout.trim() ? JSON.parse(stdout) : { stdout, stderr, exitCode };
  expect(results).toEqual({
    // A body-less response with a status that has exactly one canonical S3
    // error code maps to that code and to S3's canonical message for it.
    "stat 403": { code: "AccessDenied", message: "Access Denied" },
    "stat 404": { code: "NoSuchKey", message: "The specified key does not exist." },
    "stat 405": { code: "MethodNotAllowed", message: "The specified method is not allowed against this resource." },
    "stat 411": { code: "MissingContentLength", message: "You must provide the Content-Length HTTP header." },
    "stat 412": {
      code: "PreconditionFailed",
      message: "At least one of the preconditions you specified did not hold.",
    },
    "stat 416": { code: "InvalidRange", message: "The requested range is not satisfiable." },
    "stat 500": { code: "InternalError", message: "We encountered an internal error. Please try again." },
    "stat 501": {
      code: "NotImplemented",
      message: "A header you provided implies functionality that is not implemented.",
    },
    "stat 503": { code: "ServiceUnavailable", message: "Service is unable to handle request." },
    // A status with no single canonical S3 code keeps the generic code.
    "stat 418": { code: "UnknownError", message: "an unexpected error has occurred" },
    // Every operation goes through the same status fallback.
    "exists 403": "AccessDenied",
    "text 403": "AccessDenied",
    "stream 403": "AccessDenied",
    "write 403": "AccessDenied",
    "delete 403": "AccessDenied",
    "list 403": "AccessDenied",
    // An XML <Code>/<Message> in the body still takes precedence over the status.
    "text 403 with xml body": { code: "SignatureDoesNotMatch", message: "bad signature" },
    // A non-XML error body is the server's own diagnostic: it stays as the
    // message, and only the code comes from the status.
    "text 503 with text body": {
      code: "ServiceUnavailable",
      message: "upstream connect error or disconnect/reset before headers",
    },
    // A body-less 404 HEAD still reports "does not exist" instead of rejecting.
    "exists 404": false,
  });
  expect(exitCode).toBe(0);
});
