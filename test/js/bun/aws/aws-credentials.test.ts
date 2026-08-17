import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Every AWS_* variable the chain reads, so nothing ambient on the machine
// running the tests (a developer's ~/.aws, a CI agent's instance role) leaks in.
const STRIPPED = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ACCOUNT_ID",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_EC2_METADATA_DISABLED",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE",
  "AWS_EC2_METADATA_V1_DISABLED",
  "AWS_METADATA_SERVICE_TIMEOUT",
  "AWS_METADATA_SERVICE_NUM_ATTEMPTS",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_STS",
  "AWS_STS_REGIONAL_ENDPOINTS",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_SESSION_TOKEN",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "AWS_ENDPOINT",
  "AWS_BUCKET",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
];

let home: ReturnType<typeof tempDir>;
let baseEnv: Record<string, string | undefined>;

// ── mock endpoints ─────────────────────────────────────────────────────────

type Hit = { method: string; path: string; headers: Record<string, string>; body: string };
let imds: Server, sts: Server, container: Server, s3: Server;
const hits = { imds: [] as Hit[], sts: [] as Hit[], container: [] as Hit[], s3: [] as Hit[] };
const imdsCredsExpiration = "2099-01-01T00:00:00Z";
const imdsRole = "my-instance-role";

async function record(list: Hit[], req: Request) {
  const hit = {
    method: req.method,
    path: new URL(req.url).pathname + new URL(req.url).search,
    headers: Object.fromEntries(req.headers),
    body: await req.text(),
  };
  list.push(hit);
  return hit;
}

function stsXml(action: string, akid: string) {
  return `<${action}Response xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <${action}Result>
    <Credentials>
      <AccessKeyId>${akid}</AccessKeyId>
      <SecretAccessKey>sts-secret</SecretAccessKey>
      <SessionToken>sts-session-token</SessionToken>
      <Expiration>2099-06-01T00:00:00Z</Expiration>
    </Credentials>
  </${action}Result>
</${action}Response>`;
}

beforeAll(() => {
  home = tempDir("aws-home", { ".aws": { placeholder: "" } });
  baseEnv = { ...bunEnv, HOME: String(home), USERPROFILE: String(home), AWS_EC2_METADATA_DISABLED: "true" };
  for (const k of STRIPPED) baseEnv[k] = undefined;
  baseEnv.AWS_EC2_METADATA_DISABLED = "true";

  imds = Bun.serve({
    port: 0,
    async fetch(req) {
      const hit = await record(hits.imds, req);
      if (hit.path === "/latest/api/token") {
        if (req.method !== "PUT") return new Response("bad", { status: 405 });
        return new Response("IMDS-TOKEN");
      }
      if (req.headers.get("x-aws-ec2-metadata-token") !== "IMDS-TOKEN") {
        return new Response("unauthorized", { status: 401 });
      }
      if (hit.path === "/latest/meta-data/iam/security-credentials/") {
        return new Response(imdsRole + "\n");
      }
      if (hit.path === "/latest/meta-data/iam/security-credentials/" + imdsRole) {
        return Response.json({
          Code: "Success",
          Type: "AWS-HMAC",
          AccessKeyId: "ASIAIMDS",
          SecretAccessKey: "imds-secret",
          Token: "imds-token",
          Expiration: imdsCredsExpiration,
          LastUpdated: "2020-01-01T00:00:00Z",
        });
      }
      return new Response("??", { status: 404 });
    },
  });

  sts = Bun.serve({
    port: 0,
    async fetch(req) {
      const hit = await record(hits.sts, req);
      const params = new URLSearchParams(hit.body);
      const action = params.get("Action");
      if (params.get("RoleArn")?.includes("denied")) {
        return new Response(
          `<ErrorResponse><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>not today</Message></Error></ErrorResponse>`,
          { status: 403, headers: { "content-type": "text/xml" } },
        );
      }
      if (action === "AssumeRole") return new Response(stsXml("AssumeRole", "ASIAASSUMED"));
      if (action === "AssumeRoleWithWebIdentity")
        return new Response(stsXml("AssumeRoleWithWebIdentity", "ASIAWEBIDENT"));
      return new Response("unknown action", { status: 400 });
    },
  });

  container = Bun.serve({
    port: 0,
    async fetch(req) {
      await record(hits.container, req);
      if (req.headers.get("authorization") !== "container-auth-token") {
        return new Response("missing auth", { status: 403 });
      }
      return Response.json({
        AccessKeyId: "ASIACONTAINER",
        SecretAccessKey: "container-secret",
        Token: "container-token",
        Expiration: "2099-02-03T04:05:06Z",
        AccountId: "123456789012",
      });
    },
  });

  s3 = Bun.serve({
    port: 0,
    async fetch(req) {
      await record(hits.s3, req);
      if (req.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"abc"' } });
      if (req.method === "HEAD") return new Response(null, { headers: { "content-length": "5", etag: '"abc"' } });
      return new Response("hello", { headers: { etag: '"abc"' } });
    },
  });
});

afterAll(() => {
  for (const s of [imds, sts, container, s3]) s?.stop(true);
  home?.[Symbol.dispose]();
});

async function run(code: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: { ...baseEnv, ...env } as any,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const CREDS_SCRIPT = (opts = "") => `
  try {
    const c = await Bun.aws.credentials(${opts});
    console.log(JSON.stringify({ ...c, expiration: c.expiration?.toISOString() }));
  } catch (e) {
    console.log(JSON.stringify({ error: { code: e.code, message: e.message } }));
  }
`;

async function creds(env: Record<string, string | undefined>, opts = "") {
  const { stdout, stderr, exitCode } = await run(CREDS_SCRIPT(opts), env);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

function writeAwsFiles(dirName: string, files: { config?: string; credentials?: string }) {
  const dir = tempDir(dirName, {
    config: files.config ?? "",
    credentials: files.credentials ?? "",
  });
  return {
    dir,
    env: {
      AWS_CONFIG_FILE: join(dir, "config"),
      AWS_SHARED_CREDENTIALS_FILE: join(dir, "credentials"),
    },
  };
}

// ── the chain ──────────────────────────────────────────────────────────────

describe.concurrent("Bun.aws.credentials", () => {
  test("nothing configured → ERR_AWS_MISSING_CREDENTIALS naming every source it tried", async () => {
    const result = await creds({});
    expect(result.error.code).toBe("ERR_AWS_MISSING_CREDENTIALS");
    expect(result.error.message).toContain("AWS_ACCESS_KEY_ID");
    expect(result.error.message).toContain('profile "default"');
    expect(result.error.message).toContain("AWS_WEB_IDENTITY_TOKEN_FILE");
    expect(result.error.message).toContain("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI");
    expect(result.error.message).toContain("AWS_EC2_METADATA_DISABLED");
  });

  test("environment variables", async () => {
    const result = await creds({
      AWS_ACCESS_KEY_ID: "AKIAENV",
      AWS_SECRET_ACCESS_KEY: "env-secret",
      AWS_SESSION_TOKEN: "env-token",
      AWS_REGION: "eu-west-1",
    });
    expect(result).toEqual({
      accessKeyId: "AKIAENV",
      secretAccessKey: "env-secret",
      sessionToken: "env-token",
      region: "eu-west-1",
      source: "env",
    });
  });

  test("runtime writes to process.env are honoured", async () => {
    const { stdout, exitCode } = await run(
      `process.env.AWS_ACCESS_KEY_ID = "AKIARUNTIME"; process.env.AWS_SECRET_ACCESS_KEY = "s";` + CREDS_SCRIPT(),
      {},
    );
    expect(JSON.parse(stdout.trim())).toMatchObject({ accessKeyId: "AKIARUNTIME", source: "env" });
    expect(exitCode).toBe(0);
  });

  test("Bun.aws re-reads the environment on refresh (env keys are not frozen at first use)", async () => {
    const { stdout, exitCode } = await run(
      `
        const a = await Bun.aws.credentials();
        process.env.AWS_ACCESS_KEY_ID = "AKIAROTATED";
        process.env.AWS_REGION = "ap-south-1";
        const cached = await Bun.aws.credentials();
        const b = await Bun.aws.credentials({ refresh: true });
        console.log(a.accessKeyId, a.accountId, cached.accessKeyId, b.accessKeyId, Bun.aws.region);
      `,
      { AWS_ACCESS_KEY_ID: "AKIAFIRST", AWS_SECRET_ACCESS_KEY: "s", AWS_ACCOUNT_ID: "111122223333" },
    );
    expect(stdout.trim()).toBe("AKIAFIRST 111122223333 AKIAFIRST AKIAROTATED ap-south-1");
    expect(exitCode).toBe(0);
  });

  test("static profile in ~/.aws/credentials, region from ~/.aws/config", async () => {
    using dir = tempDir("aws-static-profile", {
      ".aws": {
        // [default] is indented the way some editors leave it; [other] has an inline comment
        credentials: `[default]\n  aws_access_key_id = AKIADEFAULT\n  aws_secret_access_key = default-secret\n\n[other]\naws_access_key_id=AKIAOTHER\naws_secret_access_key=other-secret\n# a comment line\naws_session_token = other;token #1\n`,
        config: `[default]\nregion = ap-south-1\n\n[profile other]\nregion=us-west-2\ns3 =\n  max_concurrent_requests = 20\n`,
      },
    });
    expect(await creds({ HOME: dir, USERPROFILE: dir })).toEqual({
      accessKeyId: "AKIADEFAULT",
      secretAccessKey: "default-secret",
      region: "ap-south-1",
      source: "profile",
    });
    // AWS_PROFILE picks the profile
    expect(await creds({ HOME: dir, USERPROFILE: dir, AWS_PROFILE: "other" })).toEqual({
      accessKeyId: "AKIAOTHER",
      secretAccessKey: "other-secret",
      // inline comments follow the AWS SDK for JavaScript: ` #1` is a comment, `;token` is not
      sessionToken: "other;token",
      region: "us-west-2",
      source: "profile",
    });
    // …and so does the option. A selected profile beats exported keys (as in the SDKs).
    expect(
      await creds(
        { HOME: dir, USERPROFILE: dir, AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "x" },
        `{ profile: "other" }`,
      ),
    ).toMatchObject({ accessKeyId: "AKIAOTHER", source: "profile" });
    expect(
      await creds({
        HOME: dir,
        USERPROFILE: dir,
        AWS_PROFILE: "other",
        AWS_ACCESS_KEY_ID: "AKIAENV",
        AWS_SECRET_ACCESS_KEY: "x",
      }),
    ).toMatchObject({ accessKeyId: "AKIAOTHER", source: "profile" });
    // without a profile selection, env keys win over [default]
    expect(
      await creds({ HOME: dir, USERPROFILE: dir, AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "x" }),
    ).toMatchObject({ accessKeyId: "AKIAENV", source: "env" });
    // an explicitly named profile that does not exist is an error, not a fallthrough
    const missing = await creds({ HOME: dir, USERPROFILE: dir }, `{ profile: "nope" }`);
    expect(missing.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(missing.error.message).toContain('profile "nope" was not found');
    expect(missing.error.message).not.toContain("could not read");
    // a config file that exists but cannot be read is called out (here: a directory)
    using unreadable = tempDir("aws-unreadable", { config: { "not-a-file": "" } });
    const blocked = await creds(
      { HOME: dir, USERPROFILE: dir, AWS_CONFIG_FILE: join(unreadable, "config") },
      `{ profile: "nope" }`,
    );
    expect(blocked.error.message).toContain('profile "nope" was not found');
    expect(blocked.error.message).toMatch(/could not read .*config \(E[A-Z]+\)/);
    const ambient = await creds({
      HOME: dir,
      USERPROFILE: dir,
      AWS_CONFIG_FILE: join(unreadable, "config"),
      AWS_PROFILE: "nope",
    });
    expect(ambient.error.code).toBe("ERR_AWS_MISSING_CREDENTIALS");
    expect(ambient.error.message).toMatch(/config \(could not be read: E[A-Z]+\); profile "nope" \(not found in/);
    // …and when the profile *is* found (in the readable file) but has nothing usable
    using half = tempDir("aws-half", { ".aws": { credentials: `[lonely]\nregion = us-east-1\n` } });
    const lonely = await creds(
      { HOME: half, USERPROFILE: half, AWS_CONFIG_FILE: join(unreadable, "config") },
      `{ profile: "lonely" }`,
    );
    expect(lonely.error.message).toMatch(/does not contain credentials.*; could not read .*config \(E[A-Z]+\)/);
    using ssoish = tempDir("aws-ssoish", {
      ".aws": { credentials: `[dev]\nsso_session = corp\nsso_account_id = 1\nsso_role_name = r\n` },
    });
    const dev = await creds(
      { HOME: ssoish, USERPROFILE: ssoish, AWS_CONFIG_FILE: join(unreadable, "config") },
      `{ profile: "dev" }`,
    );
    expect(dev.error.message).toMatch(/sso-session corp.*; could not read .*config \(E[A-Z]+\)/);
  });

  test("AWS_SHARED_CREDENTIALS_FILE / AWS_CONFIG_FILE override the default paths", async () => {
    const { dir, env } = writeAwsFiles("aws-file-override", {
      credentials: `[default]\naws_access_key_id = AKIAFROMFILE\naws_secret_access_key = file-secret\n`,
    });
    using _ = dir;
    expect(await creds(env)).toMatchObject({ accessKeyId: "AKIAFROMFILE", source: "profile" });
  });

  test.skipIf(isWindows)("credential_process", async () => {
    using bin = tempDir("aws-credproc", {
      "creds.sh": `#!/bin/sh\necho '{"Version": 1, "AccessKeyId": "ASIAPROCESS", "SecretAccessKey": "process-secret", "SessionToken": "process-token", "Expiration": "2099-03-04T05:06:07Z", "AccountId": "111122223333"}'\n`,
      "bad.sh": `#!/bin/sh\necho 'this went wrong' >&2\nexit 3\n`,
    });
    chmodSync(join(bin, "creds.sh"), 0o755);
    chmodSync(join(bin, "bad.sh"), 0o755);
    const ok = writeAwsFiles("aws-credproc-cfg", {
      config: `[default]\ncredential_process = ${join(bin, "creds.sh")} --some-arg\nregion = us-east-2\n[profile bad]\ncredential_process = ${join(bin, "bad.sh")}\n`,
    });
    using _ = ok.dir;
    expect(await creds(ok.env)).toEqual({
      accessKeyId: "ASIAPROCESS",
      secretAccessKey: "process-secret",
      sessionToken: "process-token",
      expiration: "2099-03-04T05:06:07.000Z",
      accountId: "111122223333",
      region: "us-east-2",
      source: "process",
    });
    const bad = await creds(ok.env, `{ profile: "bad" }`);
    expect(bad.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(bad.error.message).toContain("credential_process exited with");
    expect(bad.error.message).toContain("this went wrong");
  });

  test.skipIf(isWindows)("credentials that arrive already expired are an error, not cached", async () => {
    using bin = tempDir("aws-credproc-expired", {
      "old.sh": `#!/bin/sh\necho '{"Version": 1, "AccessKeyId": "ASIAOLD", "SecretAccessKey": "s", "SessionToken": "t", "Expiration": "2020-01-01T00:00:00Z"}'\n`,
    });
    chmodSync(join(bin, "old.sh"), 0o755);
    const files = writeAwsFiles("aws-credproc-expired-cfg", {
      config: `[default]\ncredential_process = ${join(bin, "old.sh")}\n`,
    });
    using _ = files.dir;
    const result = await creds(files.env);
    expect(result.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(result.error.message).toMatch(/credentials from process were already expired .*2020-?01-?01/);
  });

  test("role_arn + source_profile → STS AssumeRole signed with the source profile's keys", async () => {
    const files = writeAwsFiles("aws-assume-role", {
      credentials: `[base]\naws_access_key_id = AKIABASE\naws_secret_access_key = base-secret\n`,
      config: `[profile app]\nrole_arn = arn:aws:iam::123456789012:role/app\nsource_profile = base\nrole_session_name = my-session\nexternal_id = ext-42\nduration_seconds = 1800\nregion = eu-central-1\n\n[profile denied]\nrole_arn = arn:aws:iam::123456789012:role/denied\nsource_profile = base\n\n[profile loop1]\nrole_arn = arn:aws:iam::1:role/x\nsource_profile = loop2\n[profile loop2]\nrole_arn = arn:aws:iam::1:role/y\nsource_profile = loop1\n`,
    });
    using _ = files.dir;
    const env = { ...files.env, AWS_ENDPOINT_URL_STS: sts.url.href, AWS_PROFILE: "app" };
    const before = hits.sts.length;
    const result = await creds(env);
    expect(result).toEqual({
      accessKeyId: "ASIAASSUMED",
      secretAccessKey: "sts-secret",
      sessionToken: "sts-session-token",
      expiration: "2099-06-01T00:00:00.000Z",
      region: "eu-central-1",
      source: "assume-role",
    });
    // (other tests in this concurrent block hit the same mock STS with AssumeRoleWithWebIdentity)
    const hit = hits.sts.slice(before).find(h => new URLSearchParams(h.body).get("Action") === "AssumeRole")!;
    expect(hit.method).toBe("POST");
    const body = new URLSearchParams(hit.body);
    expect(body.get("RoleArn")).toBe("arn:aws:iam::123456789012:role/app");
    expect(body.get("RoleSessionName")).toBe("my-session");
    expect(body.get("ExternalId")).toBe("ext-42");
    expect(body.get("DurationSeconds")).toBe("1800");
    expect(body.get("Version")).toBe("2011-06-15");
    expect(hit.headers.authorization).toStartWith("AWS4-HMAC-SHA256 Credential=AKIABASE/");
    expect(hit.headers.authorization).toContain("/eu-central-1/sts/aws4_request");
    expect(hit.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);

    // STS error surfaces with the service's Code/Message
    const denied = await creds({ ...env, AWS_PROFILE: "denied" });
    expect(denied.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(denied.error.message).toContain("AccessDenied");
    expect(denied.error.message).toContain("not today");

    // cycles are detected
    const loop = await creds({ ...env, AWS_PROFILE: "loop1" });
    expect(loop.error.message).toContain("loops back on itself");
  });

  test("AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN → STS AssumeRoleWithWebIdentity (unsigned)", async () => {
    using dir = tempDir("aws-web-identity", { token: "  eyJhbGciOi.fake.jwt\n" });
    const before = hits.sts.length;
    const result = await creds({
      AWS_WEB_IDENTITY_TOKEN_FILE: join(dir, "token"),
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/eks-pod",
      AWS_ROLE_SESSION_NAME: "pod-session",
      AWS_ENDPOINT_URL_STS: sts.url.href,
      AWS_REGION: "us-west-2",
    });
    expect(result).toEqual({
      accessKeyId: "ASIAWEBIDENT",
      secretAccessKey: "sts-secret",
      sessionToken: "sts-session-token",
      expiration: "2099-06-01T00:00:00.000Z",
      region: "us-west-2",
      source: "web-identity",
    });
    const hit = hits.sts.slice(before).find(h => h.body.includes("AssumeRoleWithWebIdentity"))!;
    const body = new URLSearchParams(hit.body);
    expect(body.get("WebIdentityToken")).toBe("eyJhbGciOi.fake.jwt");
    expect(body.get("RoleArn")).toBe("arn:aws:iam::123456789012:role/eks-pod");
    expect(body.get("RoleSessionName")).toBe("pod-session");
    expect(hit.headers.authorization).toBeUndefined();

    // a profile can point at a token file too
    const files = writeAwsFiles("aws-web-identity-profile", {
      config: `[default]\nweb_identity_token_file = ${join(dir, "token")}\nrole_arn = arn:aws:iam::1:role/from-profile\n`,
    });
    using _ = files.dir;
    expect(await creds({ ...files.env, AWS_ENDPOINT_URL_STS: sts.url.href })).toMatchObject({
      accessKeyId: "ASIAWEBIDENT",
      source: "web-identity",
    });
  });

  test("container credentials (AWS_CONTAINER_CREDENTIALS_FULL_URI + token file)", async () => {
    using dir = tempDir("aws-container", { token: "container-auth-token\n" });
    const result = await creds({
      AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${container.port}/v2/credentials?x=1`,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: join(dir, "token"),
    });
    expect(result).toEqual({
      accessKeyId: "ASIACONTAINER",
      secretAccessKey: "container-secret",
      sessionToken: "container-token",
      expiration: "2099-02-03T04:05:06.000Z",
      accountId: "123456789012",
      source: "container",
    });
    expect(
      hits.container.some(h => h.path === "/v2/credentials?x=1" && h.headers.authorization === "container-auth-token"),
    ).toBe(true);

    // the env token works too; a wrong one is a hard error (configured but failing)
    const wrong = await creds({
      AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://localhost:${container.port}/`,
      AWS_CONTAINER_AUTHORIZATION_TOKEN: "wrong",
    });
    expect(wrong.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(wrong.error.message).toContain("HTTP 403");

    // non-loopback plain-http hosts are refused without a request being made
    const refused = await creds({ AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://example.com/creds" });
    expect(refused.error.message).toContain("must be https://");
  });

  test("EC2 instance metadata (IMDSv2)", async () => {
    const before = hits.imds.length;
    const result = await creds({
      AWS_EC2_METADATA_DISABLED: undefined,
      AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.url.href,
    });
    expect(result).toEqual({
      accessKeyId: "ASIAIMDS",
      secretAccessKey: "imds-secret",
      sessionToken: "imds-token",
      expiration: "2099-01-01T00:00:00.000Z",
      source: "imds",
    });
    const mine = hits.imds.slice(before);
    expect(mine.map(h => `${h.method} ${h.path}`)).toEqual([
      "PUT /latest/api/token",
      "GET /latest/meta-data/iam/security-credentials/",
      "GET /latest/meta-data/iam/security-credentials/my-instance-role",
    ]);
    expect(mine[0].headers["x-aws-ec2-metadata-token-ttl-seconds"]).toBe("21600");
    expect(mine[2].headers["x-aws-ec2-metadata-token"]).toBe("IMDS-TOKEN");
  });

  test("IMDSv1 fallback when the IMDSv2 token request gets no answer (container hop limit)", async () => {
    const seen: string[] = [];
    using hung = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        seen.push(`${req.method} ${path} token=${req.headers.get("x-aws-ec2-metadata-token") ?? ""}`);
        if (req.method === "PUT") return new Promise<Response>(() => {}); // never answers
        if (path.endsWith("/security-credentials/")) return new Response("role");
        return Response.json({
          Code: "Success",
          AccessKeyId: "ASIAV1",
          SecretAccessKey: "s",
          Token: "t",
          Expiration: "2099-01-01T00:00:00Z",
        });
      },
    });
    const result = await creds({
      AWS_EC2_METADATA_DISABLED: undefined,
      AWS_EC2_METADATA_SERVICE_ENDPOINT: hung.url.href,
      AWS_METADATA_SERVICE_TIMEOUT: "0.3",
    });
    expect(result).toMatchObject({ accessKeyId: "ASIAV1", source: "imds" });
    expect(seen).toEqual([
      "PUT /latest/api/token token=",
      "GET /latest/meta-data/iam/security-credentials/ token=",
      "GET /latest/meta-data/iam/security-credentials/role token=",
    ]);
    // …unless v1 is disabled
    const disabled = await creds({
      AWS_EC2_METADATA_DISABLED: undefined,
      AWS_EC2_METADATA_SERVICE_ENDPOINT: hung.url.href,
      AWS_METADATA_SERVICE_TIMEOUT: "0.3",
      AWS_EC2_METADATA_V1_DISABLED: "true",
    });
    expect(disabled.error.code).toBe("ERR_AWS_MISSING_CREDENTIALS");
  });

  test("workers with their own env resolve their own credentials", async () => {
    const { stdout, exitCode } = await run(
      `
        const main = await Bun.aws.credentials();
        const worker = new Worker("data:text/javascript," + encodeURIComponent('self.postMessage((await Bun.aws.credentials()).accessKeyId)'), {
          env: { ...process.env, AWS_ACCESS_KEY_ID: "AKIAWORKER", AWS_SECRET_ACCESS_KEY: "w" },
        });
        const fromWorker = await new Promise(resolve => (worker.onmessage = e => resolve(e.data)));
        worker.terminate();
        console.log(main.accessKeyId, fromWorker, (await Bun.aws.credentials()).accessKeyId);
      `,
      { AWS_ACCESS_KEY_ID: "AKIAMAIN", AWS_SECRET_ACCESS_KEY: "m" },
    );
    expect(stdout.trim()).toBe("AKIAMAIN AKIAWORKER AKIAMAIN");
    expect(exitCode).toBe(0);
  });

  test("a hung credential endpoint does not hold up process exit", async () => {
    using hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    const started = Date.now();
    const { stdout, exitCode } = await run(
      `
        Bun.aws.credentials().then(() => console.log("resolved?"), () => console.log("rejected?"));
        setTimeout(() => { console.log("exiting"); process.exit(0); }, 50);
      `,
      { AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${hung.port}/`, AWS_METADATA_SERVICE_TIMEOUT: "60" },
    );
    expect(stdout.trim()).toBe("exiting");
    expect(exitCode).toBe(0);
    // Far below the 60s x 3 attempts the request would otherwise wait.
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  test.skipIf(isWindows)("a hung credential_process does not hold up worker termination", async () => {
    const files = writeAwsFiles("aws-credproc-hung", {
      config: `[default]\ncredential_process = /bin/sh -c "sleep 20"\n`,
    });
    using _ = files.dir;
    const started = Date.now();
    const { stdout, exitCode } = await run(
      `
        const w = new Worker("data:text/javascript," + encodeURIComponent(\`
          Bun.aws.credentials().catch(() => {});
          self.postMessage("started");
        \`));
        await new Promise(r => (w.onmessage = r));
        await w.terminate();
        console.log("terminated");
      `,
      files.env,
    );
    expect(stdout.trim()).toBe("terminated");
    expect(exitCode).toBe(0);
    // The helper sleeps 20s; termination must not wait for it.
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test("an unreachable IMDS is 'not configured', not an error", async () => {
    // Port 9 (discard) on loopback refuses connections immediately.
    const result = await creds({
      AWS_EC2_METADATA_DISABLED: undefined,
      AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://127.0.0.1:9",
      AWS_METADATA_SERVICE_TIMEOUT: "2",
    });
    expect(result.error.code).toBe("ERR_AWS_MISSING_CREDENTIALS");
    expect(result.error.message).toContain("EC2 instance metadata (http://127.0.0.1:9 is unreachable");
  });

  test("results are cached per process; refresh: true re-resolves; expiring credentials refresh themselves", async () => {
    using dir = tempDir("aws-cache", { token: "container-auth-token" });
    const env = {
      AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${container.port}/cache-test`,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: join(dir, "token"),
    };
    const count = () => hits.container.filter(h => h.path === "/cache-test").length;
    const before = count();
    const { stdout, exitCode } = await run(
      `
        const a = await Bun.aws.credentials();
        const b = await Bun.aws.credentials();
        const [c, d] = await Promise.all([Bun.aws.credentials({ refresh: true }), Bun.aws.credentials()]);
        console.log(a.accessKeyId, b.accessKeyId, c.accessKeyId, d.accessKeyId);
      `,
      env,
    );
    expect(stdout.trim()).toBe("ASIACONTAINER ASIACONTAINER ASIACONTAINER ASIACONTAINER");
    expect(exitCode).toBe(0);
    // first call + the refresh; the concurrent 4th call joins the refresh in flight
    expect(count() - before).toBe(2);
  });

  test("short-lived credentials do not cause back-to-back refreshes", async () => {
    // Credentials issued already inside the 5-minute refresh window: they are
    // used as-is for a while rather than re-fetched on every request.
    let n = 0;
    using server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          AccessKeyId: "ASIASOON" + ++n,
          SecretAccessKey: "s",
          Token: "t",
          Expiration: new Date(Date.now() + 60_000).toISOString(),
        });
      },
    });
    const { stdout, exitCode } = await run(
      `
        const a = await Bun.aws.credentials();
        const b = await Bun.aws.credentials();
        await Bun.aws.fetch(${JSON.stringify(s3.url.href)}, { service: "s3", region: "us-east-1" });
        console.log(a.accessKeyId, b.accessKeyId);
      `,
      { AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${server.port}/` },
    );
    expect(stdout.trim()).toBe("ASIASOON1 ASIASOON1");
    expect(n).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("credentials are refreshed in the background before they expire, without any call", async () => {
    let n = 0;
    let second!: () => void;
    const refreshed = new Promise<void>(r => (second = r));
    using server = Bun.serve({
      port: 0,
      fetch() {
        if (++n >= 2) second();
        return Response.json({
          AccessKeyId: "ASIATIMER" + n,
          SecretAccessKey: "s",
          Token: "t",
          // 7s left: past the 5s expiry margin, so usable, and short enough
          // that the refresh timer is armed for ~1s out.
          Expiration: new Date(Date.now() + 7_000).toISOString(),
        });
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log((await Bun.aws.credentials()).accessKeyId); process.stdin.on("data", () => {}); // stay alive, idle`,
      ],
      env: { ...baseEnv, AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${server.port}/` } as any,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    // The second fetch comes from the timer, not from a call.
    await Promise.race([
      refreshed,
      proc.exited.then(code => Promise.reject(new Error(`child exited early (${code})`))),
    ]);
    proc.kill();
    expect(await proc.stdout.text()).toBe("ASIATIMER1\n");
    expect(n).toBeGreaterThanOrEqual(2);
  });

  test("a background refresh nobody is waiting for does not keep the process alive", async () => {
    let n = 0;
    let refreshing!: () => void;
    const refreshSeen = new Promise<void>(r => (refreshing = r));
    using server = Bun.serve({
      port: 0,
      fetch() {
        if (++n > 1) {
          refreshing();
          return new Promise<Response>(() => {}); // the refresh hangs
        }
        return Response.json({
          AccessKeyId: "ASIAEXIT",
          SecretAccessKey: "s",
          Token: "t",
          Expiration: new Date(Date.now() + 7_000).toISOString(), // refresh timer ~1s out
        });
      },
    });
    const started = Date.now();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // Idle (stdin keeps it up) until told the refresh went out, then let go
        // of stdin: nothing but the hung refresh is left, and that must not count.
        `console.log((await Bun.aws.credentials()).accessKeyId);
         process.stdin.once("data", () => { console.log("done"); process.stdin.destroy(); });`,
      ],
      env: {
        ...baseEnv,
        AWS_CONTAINER_CREDENTIALS_FULL_URI: `http://127.0.0.1:${server.port}/`,
        AWS_METADATA_SERVICE_TIMEOUT: "30",
      } as any,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    await Promise.race([refreshSeen, proc.exited]);
    proc.stdin.write("go\n");
    await proc.stdin.flush();
    expect(await proc.stdout.text()).toBe("ASIAEXIT\ndone\n");
    expect(await proc.exited).toBe(0);
    expect(n).toBe(2);
    // Well short of the hung refresh's 30s deadline.
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test("SSO profile without a cached token explains how to log in", async () => {
    const files = writeAwsFiles("aws-sso", {
      config: `[profile dev]\nsso_session = corp\nsso_account_id = 123456789012\nsso_role_name = Developer\nregion = us-east-1\n[sso-session corp]\nsso_start_url = https://corp.awsapps.com/start\nsso_region = us-east-1\n`,
    });
    using _ = files.dir;
    const result = await creds({ ...files.env, AWS_PROFILE: "dev" });
    expect(result.error.code).toBe("ERR_AWS_CREDENTIALS");
    expect(result.error.message).toContain("aws sso login --sso-session corp");
  });

  test("argument validation", () => {
    // @ts-expect-error
    expect(() => Bun.aws.credentials("default")).toThrow("options object");
    // @ts-expect-error
    expect(() => Bun.aws.credentials({ profile: 123 })).toThrow();
  });
});

// ── S3 integration ─────────────────────────────────────────────────────────

// Sequential: these assert on exact request counts against the shared mocks.
describe("S3Client with ambient credentials", () => {
  const imdsEnv = () => ({
    AWS_EC2_METADATA_DISABLED: undefined,
    AWS_EC2_METADATA_SERVICE_ENDPOINT: imds.url.href,
    S3_ENDPOINT: s3.url.href,
    S3_BUCKET: "bucket",
  });

  test("Bun.s3 / S3Client / fetch(s3://) sign with instance-metadata credentials", async () => {
    const before = hits.s3.length;
    const { stdout, stderr, exitCode } = await run(
      `
        import { s3, S3Client } from "bun";
        const results = [];
        results.push(await s3.file("a.txt").text());
        results.push(await new S3Client().file("b.txt").text());
        results.push(await (await fetch("s3://bucket/c.txt")).text());
        results.push(String((await s3.file("d.txt").stat()).size));
        await s3.file("e.txt").write("hello");
        results.push(await new Response(s3.file("f.txt").stream()).text());
        // presign is synchronous and uses the (now cached) credentials
        const url = new URL(s3.file("g.txt").presign({ expiresIn: 60 }));
        results.push(url.searchParams.get("X-Amz-Credential").split("/")[0], url.searchParams.has("X-Amz-Security-Token"));
        console.log(JSON.stringify(results));
      `,
      imdsEnv(),
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual(["hello", "hello", "hello", "5", "hello", "ASIAIMDS", true]);
    expect(exitCode).toBe(0);
    const mine = hits.s3.slice(before);
    expect(mine.length).toBe(6);
    for (const hit of mine) {
      expect(hit.headers.authorization).toStartWith("AWS4-HMAC-SHA256 Credential=ASIAIMDS/");
      expect(hit.headers["x-amz-security-token"]).toBe("imds-token");
    }
  });

  test("many concurrent first requests share one credential resolution", async () => {
    const before = hits.imds.filter(h => h.path === "/latest/api/token").length;
    const { stdout, exitCode } = await run(
      `
        import { s3 } from "bun";
        const texts = await Promise.all(Array.from({ length: 20 }, (_, i) => s3.file("k" + i).text()));
        console.log(texts.every(t => t === "hello"), texts.length);
      `,
      imdsEnv(),
    );
    expect(stdout.trim()).toBe("true 20");
    expect(exitCode).toBe(0);
    expect(hits.imds.filter(h => h.path === "/latest/api/token").length - before).toBe(1);
  });

  test("explicit keys and env keys still win; `profile` selects a profile", async () => {
    const files = writeAwsFiles("aws-s3-profile", {
      credentials: `[ci]\naws_access_key_id = AKIAPROFILECI\naws_secret_access_key = ci-secret\n`,
    });
    using _ = files.dir;
    const before = hits.s3.length;
    const { stdout, exitCode } = await run(
      `
        import { s3, S3Client } from "bun";
        await new S3Client({ accessKeyId: "AKIAEXPLICIT", secretAccessKey: "x" }).file("a").text();
        await new S3Client({ profile: "ci" }).file("b").text();
        await s3.file("c", { profile: "ci" }).text();
        console.log("ok");
      `,
      { ...imdsEnv(), ...files.env },
    );
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
    const akids = hits.s3.slice(before).map(h => h.headers.authorization.match(/Credential=([^/]+)\//)![1]);
    expect(akids).toEqual(["AKIAEXPLICIT", "AKIAPROFILECI", "AKIAPROFILECI"]);
  });

  test("synchronous presign: uses env/profile credentials on the spot, but never waits on the network", async () => {
    const files = writeAwsFiles("aws-s3-presign-sync", {
      credentials: `[default]\naws_access_key_id = AKIASTATICPROFILE\naws_secret_access_key = p\n`,
    });
    using _ = files.dir;
    // Static profile keys need no I/O, so the very first synchronous call works.
    const fromProfile = await run(
      `
        import { s3 } from "bun";
        console.log(new URL(s3.file("a").presign()).searchParams.get("X-Amz-Credential").split("/")[0]);
      `,
      { S3_ENDPOINT: s3.url.href, S3_BUCKET: "bucket", ...files.env },
    );
    expect(fromProfile.stdout.trim()).toBe("AKIASTATICPROFILE");
    expect(fromProfile.exitCode).toBe(0);

    // Instance-metadata credentials need a round-trip: the first synchronous
    // call says so (and starts resolving in the background); once anything
    // asynchronous has resolved them, synchronous calls work.
    const fromImds = await run(
      `
        import { s3 } from "bun";
        try { s3.file("a").presign(); console.log("unexpected"); } catch (e) { console.log(e.code, /have not been resolved yet.*await Bun\.aws\.credentials\(\)/.test(e.message)); }
        await Bun.aws.credentials();
        console.log(new URL(s3.file("a").presign()).searchParams.get("X-Amz-Credential").split("/")[0]);
      `,
      imdsEnv(),
    );
    expect(fromImds.stdout.trim().split("\n")).toEqual(["ERR_S3_MISSING_CREDENTIALS true", "ASIAIMDS"]);
    expect(fromImds.exitCode).toBe(0);

    // Once the chain has actually failed, the synchronous error says why
    // rather than "not resolved yet".
    using broken = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) });
    const afterFailure = await run(
      `
        import { s3 } from "bun";
        try { s3.file("a").presign(); } catch (e) { console.log(/have not been resolved yet/.test(e.message)); }
        await Bun.aws.credentials().catch(e => console.log(e.code));
        try { s3.file("a").presign(); } catch (e) { console.log(e.code, /answered HTTP 500/.test(e.message)); }
      `,
      { ...imdsEnv(), AWS_EC2_METADATA_SERVICE_ENDPOINT: broken.url.href },
    );
    expect(afterFailure.stdout.trim().split("\n")).toEqual(["true", "ERR_AWS_CREDENTIALS", "ERR_AWS_CREDENTIALS true"]);
    expect(afterFailure.exitCode).toBe(0);
  });

  test("resolution does not block the JavaScript thread", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    using slow = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (req.method === "PUT") return new Response("tok");
        if (path.endsWith("/security-credentials/")) {
          await gate; // held until the child proves its event loop is still turning
          return new Response("role");
        }
        return Response.json({
          Code: "Success",
          AccessKeyId: "ASIASLOW",
          SecretAccessKey: "s",
          Token: "t",
          Expiration: "2099-01-01T00:00:00Z",
        });
      },
    });
    using ping = Bun.serve({
      port: 0,
      fetch() {
        release();
        return new Response("pong");
      },
    });
    const { stdout, exitCode } = await run(
      `
        const pending = Bun.aws.credentials();
        // While IMDS is stalling, unrelated work keeps running: this fetch is
        // what lets IMDS answer at all.
        console.log(await (await fetch(process.env.PING_URL)).text());
        console.log((await pending).accessKeyId);
      `,
      {
        AWS_EC2_METADATA_DISABLED: undefined,
        AWS_EC2_METADATA_SERVICE_ENDPOINT: slow.url.href,
        PING_URL: ping.url.href,
      },
    );
    expect(stdout.trim().split("\n")).toEqual(["pong", "ASIASLOW"]);
    expect(exitCode).toBe(0);
  });

  test("no ambient credentials anywhere → ERR_S3_MISSING_CREDENTIALS with the chain's explanation", async () => {
    const { stdout, exitCode } = await run(
      `
        import { s3 } from "bun";
        try { await s3.file("a").text(); } catch (e) { console.log(e.code, e.message.includes("AWS_EC2_METADATA_DISABLED")); }
        try { s3.file("a").presign(); } catch (e) { console.log(e.code, e.message.includes("AWS_EC2_METADATA_DISABLED")); }
        const r = await fetch("s3://bucket/a"); // fetch resolves per WHATWG: rejection, not throw
      `.replace("const r = await", "try { await") + `} catch (e) { console.log(e.code); }`,
      { S3_ENDPOINT: s3.url.href, S3_BUCKET: "bucket" },
    );
    expect(stdout.trim().split("\n")).toEqual([
      "ERR_S3_MISSING_CREDENTIALS true",
      "ERR_S3_MISSING_CREDENTIALS true",
      "ERR_S3_MISSING_CREDENTIALS",
    ]);
    expect(exitCode).toBe(0);
  });
});
