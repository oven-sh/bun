import { afterAll, describe, it } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isASAN, isDebug } from "harness";
import path from "path";
import { spawnServer } from "s3-server";

// The server and the S3 client follow these for an http endpoint, also for one on loopback.
const noProxy = { HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined };

// The S3 server of test/packages/s3-server, in a process of its own.
const localServer = await spawnServer({
  bunExe: bunExe(),
  env: { ...bunEnv, ...noProxy },
  region: "us-east-1",
  buckets: ["buntest"],
});
afterAll(() => localServer.stop());

const { endpoint, accessKeyId, secretAccessKey, region, bucket } = localServer.clientOptions("buntest");
const env = {
  ...bunEnv,
  ...noProxy,
  BUN_JSC_gcMaxHeapSize: "503316",
  // `Bun.s3` reads an S3_* variable before the AWS_* one, so these win over what the machine has.
  S3_ENDPOINT: endpoint,
  S3_ACCESS_KEY_ID: accessKeyId,
  S3_SECRET_ACCESS_KEY: secretAccessKey,
  S3_REGION: region,
  S3_BUCKET: bucket,
  S3_SESSION_TOKEN: undefined,
  AWS_SESSION_TOKEN: undefined,
};

describe("s3", () => {
  describe("leak tests", () => {
    // The fixtures share the server. In a debug build the server needs about 20 ms for a request,
    // and with five fixtures at the same time a case takes up to 24 s. One fixture alone takes up to
    // 11 s. So a debug build or a build with ASAN runs them one at a time.
    it.concurrentIf(!isASAN && !isDebug).each([
      ["s3().stream()", "stream"],
      ["s3().text()", "text"],
      ["s3().writer().write()", "writer"],
      ["s3().write()", "write"],
      ["Bun.write", "Bun.write"],
    ])(
      "%s should not leak",
      async (_, operation) => {
        // The fixture measures 100 operations with a body of 1 MiB, so an operation that keeps its
        // body adds about 100 MiB. Without a leak the RSS grows by up to 6 MiB in a release build and
        // by up to 10 MiB in a debug build with ASAN.
        await expectRssDeltaBelow(
          ["--smol", path.join(import.meta.dir, "s3-leak-fixture.ts"), operation],
          { release: 25, debug: 40 },
          env,
        );
      },
      30_000,
    );
  });
});
