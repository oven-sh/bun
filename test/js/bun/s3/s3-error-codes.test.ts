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
    // Statuses with exactly one canonical S3 error code map to it.
    "stat 403": "AccessDenied",
    "stat 404": "NoSuchKey",
    "stat 405": "MethodNotAllowed",
    "stat 411": "MissingContentLength",
    "stat 412": "PreconditionFailed",
    "stat 416": "InvalidRange",
    "stat 500": "InternalError",
    "stat 501": "NotImplemented",
    "stat 503": "ServiceUnavailable",
    // A status with no single canonical S3 code keeps the generic code.
    "stat 418": "UnknownError",
    // Every operation goes through the same status fallback.
    "exists 403": "AccessDenied",
    "text 403": "AccessDenied",
    "stream 403": "AccessDenied",
    "write 403": "AccessDenied",
    "delete 403": "AccessDenied",
    "list 403": "AccessDenied",
    // An XML <Code> in the body still takes precedence over the status.
    "text 403 with xml body": "SignatureDoesNotMatch",
    // A body-less 404 HEAD still reports "does not exist" instead of rejecting.
    "exists 404": false,
  });
  expect(exitCode).toBe(0);
});
