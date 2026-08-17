import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "crypto";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const STRIPPED = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_CONFIG",
  "GCE_METADATA_HOST",
  "GCE_METADATA_IP",
  "GCE_METADATA_TIMEOUT",
  "NO_GCE_CHECK",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_CLOUD_UNIVERSE_DOMAIN",
  "HTTPS_PROXY",
  "https_proxy",
];

let baseEnv: Record<string, string | undefined>;
let tokenServer: Server, metadata: Server, echo: Server;
type Hit = { method: string; path: string; headers: Record<string, string>; body: string };
const hits = { token: [] as Hit[], metadata: [] as Hit[] };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;

function b64urlDecode(s: string) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function fakeJwt(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claims)}.c2ln`;
}

async function record(list: Hit[], req: Request) {
  const url = new URL(req.url);
  const hit = {
    method: req.method,
    path: url.pathname + url.search,
    headers: Object.fromEntries(req.headers),
    body: await req.text(),
  };
  list.push(hit);
  return hit;
}

let home: ReturnType<typeof tempDir>;
beforeAll(() => {
  home = tempDir("gcp-home", { ".config": { placeholder: "" } });
  baseEnv = { ...bunEnv, HOME: String(home), USERPROFILE: String(home), APPDATA: String(home), NO_GCE_CHECK: "true" };
  for (const k of STRIPPED) baseEnv[k] = undefined;
  baseEnv.NO_GCE_CHECK = "true";

  // oauth2.googleapis.com/token stand-in
  tokenServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const hit = await record(hits.token, req);
      const form = new URLSearchParams(hit.body);
      const grant = form.get("grant_type");
      if (grant === "urn:ietf:params:oauth:grant-type:jwt-bearer") {
        const assertion = form.get("assertion")!;
        const [h, p, sig] = assertion.split(".");
        const header = JSON.parse(b64urlDecode(h).toString());
        const claims = JSON.parse(b64urlDecode(p).toString());
        const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, b64urlDecode(sig));
        if (!ok || header.alg !== "RS256") {
          return Response.json(
            { error: "invalid_grant", error_description: "Invalid JWT Signature." },
            { status: 400 },
          );
        }
        if (claims.iss === "denied@proj.iam.gserviceaccount.com") {
          return Response.json({ error: "invalid_grant", error_description: "account not found" }, { status: 400 });
        }
        if (claims.target_audience) {
          return Response.json({
            id_token: fakeJwt({ aud: claims.target_audience, iss: "https://accounts.google.com", exp: 4102444800 }),
          });
        }
        return Response.json({
          access_token: `sa-token-for:${claims.iss}:${claims.scope}:kid=${header.kid}`,
          expires_in: 3599,
          token_type: "Bearer",
        });
      }
      if (grant === "refresh_token") {
        if (form.get("refresh_token") !== "1//refresh-me") {
          return Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 });
        }
        return Response.json({
          access_token: `user-token:${form.get("client_id")}:${form.get("scope") ?? "default"}`,
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/cloud-platform",
          token_type: "Bearer",
          // Google honours target_audience for some clients; model both.
          id_token: fakeJwt({
            aud: form.get("target_audience")?.startsWith("https://honoured.")
              ? form.get("target_audience")
              : form.get("client_id"),
            exp: 4102444800,
          }),
        });
      }
      return new Response("unknown grant", { status: 400 });
    },
  });

  metadata = Bun.serve({
    port: 0,
    async fetch(req) {
      const hit = await record(hits.metadata, req);
      const headers = { "metadata-flavor": "Google" };
      if (req.headers.get("metadata-flavor") !== "Google") {
        return new Response("Missing Metadata-Flavor:Google header", { status: 403, headers });
      }
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/computeMetadata/v1/instance/service-accounts/default/token":
          return Response.json(
            {
              access_token: `metadata-token:${url.searchParams.get("scopes") ?? "default"}`,
              expires_in: 3000,
              token_type: "Bearer",
            },
            { headers },
          );
        case "/computeMetadata/v1/instance/service-accounts/default/identity":
          return new Response(fakeJwt({ aud: url.searchParams.get("audience"), exp: 4102444800 }), { headers });
        case "/computeMetadata/v1/instance/service-accounts/default/email":
          return new Response("vm@proj.iam.gserviceaccount.com", { headers });
        case "/computeMetadata/v1/project/project-id":
          return new Response("my-project", { headers });
      }
      return new Response("not found", { status: 404, headers });
    },
  });

  echo = Bun.serve({
    port: 0,
    fetch(req) {
      return Response.json(Object.fromEntries(req.headers));
    },
  });
});

afterAll(() => {
  for (const s of [tokenServer, metadata, echo]) s?.stop(true);
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

const TOKEN_SCRIPT = (call: string) => `
  try {
    const t = await ${call};
    console.log(JSON.stringify({ ...t, expiration: t.expiration?.toISOString() }));
  } catch (e) {
    console.log(JSON.stringify({ error: { code: e.code, message: e.message } }));
  }
`;

async function token(env: Record<string, string | undefined>, call = "Bun.gcp.accessToken()") {
  const { stdout, stderr, exitCode } = await run(TOKEN_SCRIPT(call), env);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

function serviceAccountFile(email = "robot@proj.iam.gserviceaccount.com") {
  return JSON.stringify({
    type: "service_account",
    project_id: "proj",
    private_key_id: "key-1",
    private_key: privateKeyPem,
    client_email: email,
    client_id: "1234",
    token_uri: `http://127.0.0.1:${tokenServer.port}/token`,
  });
}

function authorizedUserFile() {
  return JSON.stringify({
    type: "authorized_user",
    client_id: "client.apps.googleusercontent.com",
    client_secret: "shh",
    refresh_token: "1//refresh-me",
    quota_project_id: "billing-proj",
    token_uri: `http://127.0.0.1:${tokenServer.port}/token`,
  });
}

describe.concurrent("Bun.gcp", () => {
  test("nothing configured → ERR_GCP_MISSING_CREDENTIALS naming every source", async () => {
    const r = await token({});
    expect(r.error.code).toBe("ERR_GCP_MISSING_CREDENTIALS");
    expect(r.error.message).toContain("GOOGLE_APPLICATION_CREDENTIALS (not set)");
    expect(r.error.message).toContain("application_default_credentials.json");
    expect(r.error.message).toContain("NO_GCE_CHECK");
  });

  test("service account key file → RS256-signed JWT exchanged for an access token", async () => {
    using dir = tempDir("gcp-sa", { "sa.json": serviceAccountFile() });
    const before = hits.token.length;
    const r = await token({ GOOGLE_APPLICATION_CREDENTIALS: join(dir, "sa.json") });
    expect(r).toEqual({
      token: "sa-token-for:robot@proj.iam.gserviceaccount.com:https://www.googleapis.com/auth/cloud-platform:kid=key-1",
      expiration: expect.any(String),
      source: "service-account",
      email: "robot@proj.iam.gserviceaccount.com",
      projectId: "proj",
    });
    expect(new Date(r.expiration).getTime()).toBeGreaterThan(Date.now() + 3000_000);
    const hit = hits.token.slice(before).find(h => {
      const form = new URLSearchParams(h.body);
      if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return false;
      const c = JSON.parse(b64urlDecode(form.get("assertion")!.split(".")[1]).toString());
      return (
        c.iss === "robot@proj.iam.gserviceaccount.com" && c.scope === "https://www.googleapis.com/auth/cloud-platform"
      );
    })!;
    const claims = JSON.parse(b64urlDecode(new URLSearchParams(hit.body).get("assertion")!.split(".")[1]).toString());
    expect(claims).toEqual({
      iss: "robot@proj.iam.gserviceaccount.com",
      sub: "robot@proj.iam.gserviceaccount.com",
      aud: `http://127.0.0.1:${tokenServer.port}/token`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      iat: expect.any(Number),
      exp: claims.iat + 3600,
    });

    // custom scopes (bare names expand), and an ID token for an audience
    const scoped = await token(
      { GOOGLE_APPLICATION_CREDENTIALS: join(dir, "sa.json") },
      `Bun.gcp.accessToken({ scopes: ["devstorage.read_only", "https://www.googleapis.com/auth/pubsub"] })`,
    );
    expect(scoped.token).toEndWith(
      ":https://www.googleapis.com/auth/devstorage.read_only https://www.googleapis.com/auth/pubsub:kid=key-1",
    );
    const id = await token(
      { GOOGLE_APPLICATION_CREDENTIALS: join(dir, "sa.json") },
      `Bun.gcp.idToken("https://my-service-abc.a.run.app")`,
    );
    expect(id.source).toBe("service-account");
    expect(JSON.parse(b64urlDecode(id.token.split(".")[1]).toString()).aud).toBe("https://my-service-abc.a.run.app");
    expect(id.expiration).toBe("2100-01-01T00:00:00.000Z");

    // token endpoint errors carry Google's error_description
    using denied = tempDir("gcp-sa-denied", { "sa.json": serviceAccountFile("denied@proj.iam.gserviceaccount.com") });
    const bad = await token({ GOOGLE_APPLICATION_CREDENTIALS: join(denied, "sa.json") });
    expect(bad.error.code).toBe("ERR_GCP_CREDENTIALS");
    expect(bad.error.message).toContain("invalid_grant: account not found");
  });

  test("authorized_user ADC file from the well-known gcloud location", async () => {
    using cfgdir = tempDir("gcp-gcloud", { "application_default_credentials.json": authorizedUserFile() });
    const r = await token({ CLOUDSDK_CONFIG: String(cfgdir) });
    expect(r).toEqual({
      token: "user-token:client.apps.googleusercontent.com:default",
      expiration: expect.any(String),
      source: "authorized-user",
      quotaProjectId: "billing-proj",
    });
    // ID tokens: `target_audience` is sent and whatever Google issues is
    // returned, as google-auth-library does (for user credentials that is
    // usually a token for gcloud's client ID, which Cloud Run accepts).
    const aud = async (audience: string) =>
      JSON.parse(
        b64urlDecode(
          (
            await token({ CLOUDSDK_CONFIG: String(cfgdir) }, `Bun.gcp.idToken(${JSON.stringify(audience)})`)
          ).token.split(".")[1],
        ).toString(),
      ).aud;
    expect(await aud("https://honoured.run.app")).toBe("https://honoured.run.app");
    expect(await aud("https://svc.a.run.app")).toBe("client.apps.googleusercontent.com");
    // unsupported credential types say so
    using ext = tempDir("gcp-ext", { "creds.json": JSON.stringify({ type: "external_account", audience: "x" }) });
    const e = await token({ GOOGLE_APPLICATION_CREDENTIALS: join(ext, "creds.json") });
    expect(e.error.message).toContain('type "external_account"');
    // a missing GOOGLE_APPLICATION_CREDENTIALS file is a hard error
    const missing = await token({ GOOGLE_APPLICATION_CREDENTIALS: join(ext, "nope.json") });
    expect(missing.error.message).toContain("could not read credentials file");
  });

  test.skipIf(isWindows)("authorized_user ADC file under ~/.config/gcloud (POSIX layout)", async () => {
    using home = tempDir("gcp-home2", {
      ".config": { gcloud: { "application_default_credentials.json": authorizedUserFile() } },
    });
    expect(await token({ HOME: String(home) })).toMatchObject({ source: "authorized-user" });
  });
  test("metadata server (GCE / GKE / Cloud Run)", async () => {
    const env = { NO_GCE_CHECK: undefined, GCE_METADATA_HOST: `127.0.0.1:${metadata.port}` };
    const before = hits.metadata.length;
    expect(await token(env)).toEqual({
      token: "metadata-token:default",
      expiration: expect.any(String),
      source: "metadata",
      email: "vm@proj.iam.gserviceaccount.com",
      projectId: "my-project",
    });
    for (const hit of hits.metadata.slice(before)) expect(hit.headers["metadata-flavor"]).toBe("Google");

    expect((await token(env, `Bun.gcp.accessToken({ scopes: "bigquery,pubsub" })`)).token).toBe(
      "metadata-token:https://www.googleapis.com/auth/bigquery,https://www.googleapis.com/auth/pubsub",
    );
    const id = await token(env, `Bun.gcp.idToken({ audience: "https://example.com" })`);
    expect(JSON.parse(b64urlDecode(id.token.split(".")[1]).toString()).aud).toBe("https://example.com");
    expect(id.source).toBe("metadata");

    {
      // a VM with no service account attached
      using bare = Bun.serve({
        port: 0,
        fetch: () => new Response("Not Found", { status: 404, headers: { "metadata-flavor": "Google" } }),
      });
      const none = await token({ NO_GCE_CHECK: undefined, GCE_METADATA_HOST: `127.0.0.1:${bare.port}` });
      expect(none.error.code).toBe("ERR_GCP_CREDENTIALS");
      expect(none.error.message).toContain("no default service account");
    }

    // an unreachable metadata host means "not on GCP"
    const off = await token({ NO_GCE_CHECK: undefined, GCE_METADATA_HOST: "127.0.0.1:9", GCE_METADATA_TIMEOUT: "2" });
    expect(off.error.code).toBe("ERR_GCP_MISSING_CREDENTIALS");
    expect(off.error.message).toContain("is unreachable");
  });

  test("tokens are cached per scope set; refresh: true re-fetches", async () => {
    const env = { NO_GCE_CHECK: undefined, GCE_METADATA_HOST: `127.0.0.1:${metadata.port}` };
    // Scopes unique to this test so concurrent tests' hits don't count.
    const count = () => hits.metadata.filter(h => h.path.includes("cachetest")).length;
    const before = count();
    const { stdout, exitCode } = await run(
      `
        const one = { scopes: ["https://www.googleapis.com/auth/cachetest1"] };
        const a = await Bun.gcp.accessToken(one);
        const b = await Bun.gcp.accessToken(one);
        const c = await Bun.gcp.accessToken({ scopes: "https://www.googleapis.com/auth/cachetest1" }); // same set
        const d = await Bun.gcp.accessToken({ scopes: "cachetest2" });
        const [e, f] = await Promise.all([Bun.gcp.accessToken({ ...one, refresh: true }), Bun.gcp.accessToken(one)]);
        console.log([a, b, c, d, e, f].map(t => t.token.replace("metadata-token:https://www.googleapis.com/auth/", "")).join(" "));
      `,
      env,
    );
    expect(stdout.trim()).toBe("cachetest1 cachetest1 cachetest1 cachetest2 cachetest1 cachetest1");
    expect(exitCode).toBe(0);
    expect(count() - before).toBe(3);
  });

  test("Bun.gcp.fetch adds the bearer token and quota project", async () => {
    using cfgdir = tempDir("gcp-fetch", { "application_default_credentials.json": authorizedUserFile() });
    using sa = tempDir("gcp-fetch-sa", { "sa.json": serviceAccountFile() });
    const { stdout, stderr, exitCode } = await run(
      `
        const echo = ${JSON.stringify(echo.url.href)};
        const a = await (await Bun.gcp.fetch(echo)).json();
        const b = await (await Bun.gcp.fetch(echo, { scopes: ["bigquery"], headers: { "x-goog-user-project": "mine" } })).json();
        process.env.GOOGLE_APPLICATION_CREDENTIALS = ${JSON.stringify(join(sa, "sa.json"))};
        const c = await (await Bun.gcp.fetch(echo, { audience: "https://run.app/x" })).json();
        // { url, ...init } shape, with a second init that does not name a token kind
        const c2 = await (await Bun.gcp.fetch({ url: echo, audience: "https://run.app/x" }, { headers: { "x-extra": "1" } })).json();
        if (c2.authorization !== c.authorization || c2["x-extra"] !== "1") throw new Error("init-dict overlay: " + JSON.stringify(c2));
        const errors = [];
        for (const init of [{ audience: "a", scopes: "b" }, { headers: { Authorization: "x" } }]) {
          try { await Bun.gcp.fetch(echo, init); errors.push("no error"); } catch (e) { errors.push(e.message); }
        }
        try { await Bun.gcp.fetch("s3://b/k"); errors.push("no error"); } catch (e) { errors.push(e.message); }
        console.log(JSON.stringify({ a, b, c, errors }));
      `,
      { CLOUDSDK_CONFIG: String(cfgdir) },
    );
    expect(stderr).toBe("");
    const { a, b, c, errors } = JSON.parse(stdout.trim());
    expect(a.authorization).toBe("Bearer user-token:client.apps.googleusercontent.com:default");
    expect(a["x-goog-user-project"]).toBe("billing-proj");
    expect(b.authorization).toBe(
      "Bearer user-token:client.apps.googleusercontent.com:https://www.googleapis.com/auth/bigquery",
    );
    expect(b["x-goog-user-project"]).toBe("mine");
    expect(c.authorization).toStartWith("Bearer ey");
    expect(JSON.parse(b64urlDecode(c.authorization.split(".")[1]).toString()).aud).toBe("https://run.app/x");
    expect(errors).toEqual([
      expect.stringContaining("mutually exclusive"),
      expect.stringContaining('sets the "Authorization" header itself'),
      expect.stringContaining("s3:// URLs"),
    ]);
    expect(exitCode).toBe(0);
  });

  test("GCPClient instances: keyFile / inline credentials / default audience", async () => {
    using dir = tempDir("gcp-clients", {
      "a.json": serviceAccountFile("a@proj.iam.gserviceaccount.com"),
      "b.json": serviceAccountFile("b@proj.iam.gserviceaccount.com"),
    });
    const { stdout, stderr, exitCode } = await run(
      `
        const echo = ${JSON.stringify(echo.url.href)};
        const a = new Bun.GCPClient({ keyFile: ${JSON.stringify(join(dir, "a.json"))} });
        const b = new Bun.GCPClient({ credentials: await Bun.file(${JSON.stringify(join(dir, "b.json"))}).json(), scopes: ["bigquery"] });
        const c = new Bun.GCPClient({ credentials: await Bun.file(${JSON.stringify(join(dir, "a.json"))}).text(), audience: "https://svc.run.app" });
        const [ta, tb, tc] = await Promise.all([a.accessToken(), b.accessToken(), c.idToken()]);
        const viaFetch = await (await b.fetch(echo)).json();
        const override = await (await b.fetch(echo, { scopes: "pubsub" })).json();
        console.log(JSON.stringify({
          a: ta.token, aEmail: ta.email, b: tb.token, cAud: JSON.parse(atob(tc.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aud,
          viaFetch: viaFetch.authorization, override: override.authorization,
          isInstance: Bun.gcp instanceof Bun.GCPClient && a instanceof Bun.GCPClient,
        }));
      `,
      {},
    );
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect(out).toEqual({
      a: "sa-token-for:a@proj.iam.gserviceaccount.com:https://www.googleapis.com/auth/cloud-platform:kid=key-1",
      aEmail: "a@proj.iam.gserviceaccount.com",
      b: "sa-token-for:b@proj.iam.gserviceaccount.com:https://www.googleapis.com/auth/bigquery:kid=key-1",
      cAud: "https://svc.run.app",
      viaFetch: "Bearer sa-token-for:b@proj.iam.gserviceaccount.com:https://www.googleapis.com/auth/bigquery:kid=key-1",
      override: "Bearer sa-token-for:b@proj.iam.gserviceaccount.com:https://www.googleapis.com/auth/pubsub:kid=key-1",
      isInstance: true,
    });
    expect(exitCode).toBe(0);
  });

  test("argument validation", () => {
    // @ts-expect-error
    expect(() => Bun.gcp.accessToken("cloud-platform")).toThrow("options object");
    // @ts-expect-error
    expect(() => new Bun.GCPClient(1)).toThrow("options must be an object");
    expect(() => new Bun.GCPClient({ credentials: 1 as any })).toThrow("credentials must be");
    expect(() => Bun.gcp.accessToken({ scopes: [123 as any] })).toThrow("scope");
    expect(() => Bun.gcp.idToken()).toThrow("audience");
    expect(() => Bun.gcp.idToken({ audience: "" })).toThrow("audience");
  });
});
