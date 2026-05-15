import { spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, stderrForInstall } from "harness";
import { join } from "path";

// A Verdaccio instance is used only for `registry.createTestDir()` — all
// actual publish PUTs in these tests go to an in-process `Bun.serve` mock
// so we can inspect the body.
const registry = new VerdaccioRegistry();
beforeAll(async () => {
  setDefaultTimeout(1000 * 60 * 5);
  await registry.start();
});
afterAll(() => {
  registry.stop();
});

async function publish(env: Record<string, string | undefined>, cwd: string, ...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "publish", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const out = await stdout.text();
  const err = stderrForInstall(await stderr.text());
  const exitCode = await exited;
  return { out, err, exitCode };
}

// Any syntactically-valid PEM — Fulcio response parsing only needs to
// base64-decode the body into `rawBytes` for the bundle; neither the
// registry nor the test asserts on the DER contents.
const DUMMY_CERT_PEM =
  "-----BEGIN CERTIFICATE-----\n" + "TUlJQkZ1bGNpb01vY2tDZXJ0aWZpY2F0ZQ==\n" + "-----END CERTIFICATE-----\n";

// Minimal JWT with `{"sub":"repo:oven-sh/bun:ref:refs/heads/main","aud":"sigstore"}`
// for the proof-of-possession subject extraction.
function fakeJwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
  return (
    b64({ alg: "none", typ: "JWT" }) +
    "." +
    b64({ sub: "repo:oven-sh/bun:ref:refs/heads/main", aud: "sigstore" }) +
    ".sig"
  );
}

// Rekor /api/v1/log/entries response — `{ "<uuid>": <entry> }`.
function fakeRekorResponse() {
  const body = {
    apiVersion: "0.0.2",
    kind: "intoto",
    spec: { content: {} },
  };
  return {
    mockuuid0000: {
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
      integratedTime: 1700000000,
      // 32-byte hex — becomes the bundle's `logId.keyId`.
      logID: "c0ffee".repeat(10) + "ee".repeat(2),
      logIndex: 424242,
      verification: {
        signedEntryTimestamp: Buffer.from("set").toString("base64"),
      },
    },
  };
}

describe("--provenance", () => {
  test("attaches a sigstore bundle built against mock Fulcio/Rekor (GitHub Actions)", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    // What the registry receives, so we can assert on the PUT body.
    let putBody: any = null;
    let fulcioReq: any = null;
    let rekorReq: any = null;
    let oidcUrl: string | null = null;

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        // GitHub Actions OIDC token endpoint.
        if (url.pathname === "/gha-oidc") {
          oidcUrl = req.url;
          expect(url.searchParams.get("audience")).toBe("sigstore");
          expect(req.headers.get("authorization")).toBe("Bearer gha-req-tok");
          return Response.json({ value: fakeJwt() });
        }
        // Fulcio.
        if (url.pathname === "/api/v2/signingCert") {
          fulcioReq = await req.json();
          return Response.json({
            signedCertificateEmbeddedSct: {
              chain: { certificates: [DUMMY_CERT_PEM, DUMMY_CERT_PEM] },
            },
          });
        }
        // Rekor.
        if (url.pathname === "/api/v1/log/entries") {
          rekorReq = await req.json();
          return Response.json(fakeRekorResponse(), { status: 201 });
        }
        // npm registry PUT.
        if (req.method === "PUT") {
          putBody = await req.json();
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://localhost:${server.port}`;

    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-1", version: "1.2.3" })),
    ]);

    const env = {
      ...bunEnv,
      // Pretend we're in GitHub Actions with id-token: write.
      GITHUB_ACTIONS: "true",
      ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/gha-oidc`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gha-req-tok",
      GITHUB_REPOSITORY: "oven-sh/bun",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_WORKFLOW_REF: "oven-sh/bun/.github/workflows/release.yml@refs/heads/main",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "deadbeef",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REPOSITORY_ID: "1",
      GITHUB_REPOSITORY_OWNER_ID: "2",
      GITHUB_RUN_ID: "99",
      GITHUB_RUN_ATTEMPT: "1",
      RUNNER_ENVIRONMENT: "github-hosted",
      // Point sigstore at our mock.
      BUN_SIGSTORE_FULCIO_URL: base,
      BUN_SIGSTORE_REKOR_URL: base,
      CI: "1",
    };

    const { out, err, exitCode } = await publish(env, packageDir, "--provenance", "--access", "public");
    // user-facing notices go to stdout via Output::prettyln.
    expect(out + err).toContain("Signed provenance statement");
    expect(out + err).toContain("Transparency log");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    // ── OIDC flow ────────────────────────────────────────────────────
    expect(oidcUrl).not.toBeNull();

    // ── Fulcio request shape (sigstore-js `toCertificateRequest`) ────
    expect(fulcioReq).not.toBeNull();
    expect(fulcioReq.credentials.oidcIdentityToken).toBe(fakeJwt());
    expect(fulcioReq.publicKeyRequest.publicKey.algorithm).toBe("ECDSA");
    expect(fulcioReq.publicKeyRequest.publicKey.content).toContain("-----BEGIN PUBLIC KEY-----");
    expect(typeof fulcioReq.publicKeyRequest.proofOfPossession).toBe("string");
    expect(fulcioReq.publicKeyRequest.proofOfPossession.length).toBeGreaterThan(0);

    // ── Rekor request shape (sigstore-js `toProposedIntotoEntry`) ────
    expect(rekorReq).not.toBeNull();
    expect(rekorReq.kind).toBe("intoto");
    expect(rekorReq.apiVersion).toBe("0.0.2");
    expect(rekorReq.spec.content.envelope.payloadType).toBe("application/vnd.in-toto+json");
    expect(rekorReq.spec.content.hash.algorithm).toBe("sha256");
    expect(rekorReq.spec.content.payloadHash.algorithm).toBe("sha256");

    // ── Registry PUT body (libnpmpublish) ────────────────────────────
    expect(putBody).not.toBeNull();
    expect(putBody.name).toBe("prov-pkg-1");
    expect(putBody._attachments["prov-pkg-1-1.2.3.tgz"]).toBeDefined();

    const att = putBody._attachments["prov-pkg-1-1.2.3.sigstore"];
    expect(att).toBeDefined();
    expect(att.content_type).toBe("application/vnd.dev.sigstore.bundle+json;version=0.2");
    expect(att.length).toBe(att.data.length);

    const bundle = JSON.parse(att.data);
    expect(bundle.mediaType).toBe("application/vnd.dev.sigstore.bundle+json;version=0.2");

    // DSSE envelope — payload is the base64'd in-toto statement.
    expect(bundle.dsseEnvelope.payloadType).toBe("application/vnd.in-toto+json");
    expect(bundle.dsseEnvelope.signatures).toHaveLength(1);
    const stmt = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
    expect(stmt._type).toBe("https://in-toto.io/Statement/v1");
    expect(stmt.predicateType).toBe("https://slsa.dev/provenance/v1");
    expect(stmt.subject).toHaveLength(1);
    expect(stmt.subject[0].name).toBe("pkg:npm/prov-pkg-1@1.2.3");
    expect(stmt.subject[0].digest.sha512).toMatch(/^[0-9a-f]{128}$/);
    // GitHub env → buildDefinition.
    expect(stmt.predicate.buildDefinition.externalParameters.workflow.repository).toBe(
      "https://github.com/oven-sh/bun",
    );
    expect(stmt.predicate.buildDefinition.externalParameters.workflow.path).toBe(".github/workflows/release.yml");
    expect(stmt.predicate.buildDefinition.externalParameters.workflow.ref).toBe("refs/heads/main");
    expect(stmt.predicate.runDetails.builder.id).toBe("https://github.com/actions/runner/github-hosted");

    // Verification material: leaf cert + tlog entry from mock Rekor.
    expect(bundle.verificationMaterial.x509CertificateChain.certificates).toHaveLength(1);
    expect(bundle.verificationMaterial.tlogEntries).toHaveLength(1);
    const tlog = bundle.verificationMaterial.tlogEntries[0];
    expect(tlog.logIndex).toBe("424242");
    expect(tlog.kindVersion).toEqual({ kind: "intoto", version: "0.0.2" });
    expect(tlog.integratedTime).toBe("1700000000");
    expect(tlog.inclusionPromise.signedEntryTimestamp).toBe(Buffer.from("set").toString("base64"));
  });

  test("errors outside of supported CI", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 200 }),
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-2", version: "1.0.0" })),
    ]);
    const env = {
      ...bunEnv,
      GITHUB_ACTIONS: undefined,
      GITLAB_CI: undefined,
      CI: undefined,
    };
    const { err, exitCode } = await publish(env, packageDir, "--provenance", "--access", "public");
    expect(err).toContain("Automatic provenance generation not supported");
    expect(exitCode).toBe(1);
  });

  test("errors in GitHub Actions without id-token permission", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 200 }),
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-3", version: "1.0.0" })),
    ]);
    const env = {
      ...bunEnv,
      GITHUB_ACTIONS: "true",
      ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
      CI: "1",
    };
    const { err, exitCode } = await publish(env, packageDir, "--provenance", "--access", "public");
    expect(err).toContain('"write" access to the "id-token" permission');
    expect(exitCode).toBe(1);
  });

  test("requires --access public", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 200 }),
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-4", version: "1.0.0" })),
    ]);
    const { err, exitCode } = await publish({ ...bunEnv, GITHUB_ACTIONS: "true", CI: "1" }, packageDir, "--provenance");
    expect(err).toContain("--access public");
    expect(exitCode).toBe(1);
  });

  test("NPM_CONFIG_PROVENANCE=true enables it; --no-provenance wins", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    let putBody: any = null;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") {
          putBody = await req.json();
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-5", version: "1.0.0" })),
    ]);

    // NPM_CONFIG_PROVENANCE=true alone (no CI) → should try and fail
    // without --no-provenance…
    {
      const { err, exitCode } = await publish(
        {
          ...bunEnv,
          NPM_CONFIG_PROVENANCE: "true",
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
        },
        packageDir,
        "--access",
        "public",
      );
      expect(err).toContain("Automatic provenance generation not supported");
      expect(exitCode).toBe(1);
    }

    // …but --no-provenance overrides it and publishes cleanly.
    {
      const { err, exitCode } = await publish(
        {
          ...bunEnv,
          NPM_CONFIG_PROVENANCE: "true",
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
        },
        packageDir,
        "--access",
        "public",
        "--no-provenance",
      );
      expect(exitCode).toBe(0);
      expect(putBody).not.toBeNull();
      expect(putBody._attachments["prov-pkg-5-1.0.0.sigstore"]).toBeUndefined();
    }
  });

  test("publishConfig.provenance: true enables it; --no-provenance wins", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    let putBody: any = null;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") {
          putBody = await req.json();
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(
        packageJson,
        JSON.stringify({
          name: "prov-pkg-7",
          version: "1.0.0",
          publishConfig: { provenance: true },
        }),
      ),
    ]);

    // publishConfig.provenance: true alone (no CI, no flag) → should try
    // and fail…
    {
      const { err, exitCode } = await publish(
        { ...bunEnv, GITHUB_ACTIONS: undefined, GITLAB_CI: undefined },
        packageDir,
        "--access",
        "public",
      );
      expect(err).toContain("Automatic provenance generation not supported");
      expect(exitCode).toBe(1);
    }

    // …but --no-provenance on the CLI overrides publishConfig and
    // publishes cleanly.
    {
      const { err, exitCode } = await publish(
        { ...bunEnv, GITHUB_ACTIONS: undefined, GITLAB_CI: undefined },
        packageDir,
        "--access",
        "public",
        "--no-provenance",
      );
      expect(exitCode).toBe(0);
      expect(putBody).not.toBeNull();
      expect(putBody._attachments["prov-pkg-7-1.0.0.sigstore"]).toBeUndefined();
    }

    // publishConfig.provenance: false suppresses NPM_CONFIG_PROVENANCE.
    putBody = null;
    await write(
      packageJson,
      JSON.stringify({
        name: "prov-pkg-7",
        version: "1.0.1",
        publishConfig: { provenance: false },
      }),
    );
    {
      const { err, exitCode } = await publish(
        {
          ...bunEnv,
          NPM_CONFIG_PROVENANCE: "true",
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
        },
        packageDir,
        "--access",
        "public",
      );
      expect(exitCode).toBe(0);
      expect(putBody).not.toBeNull();
      expect(putBody._attachments["prov-pkg-7-1.0.1.sigstore"]).toBeUndefined();
    }
  });

  test("--provenance-file: attaches when subject matches, rejects when it doesn't", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    let putBody: any = null;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") {
          putBody = await req.json();
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://localhost:${server.port}`;

    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-6", version: "2.0.0" })),
    ]);

    const makeBundle = (subjectName: string, sha512: string) => ({
      mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify({ subject: [{ name: subjectName, digest: { sha512 } }] })).toString(
          "base64",
        ),
        payloadType: "application/vnd.in-toto+json",
        signatures: [{ sig: "AA==", keyid: "" }],
      },
    });

    // Subject mismatch → rejected before any PUT.
    {
      const badPath = join(packageDir, "bad.sigstore");
      await write(badPath, JSON.stringify(makeBundle("pkg:npm/other@1.0.0", "00")));
      const { err, exitCode } = await publish(
        { ...bunEnv },
        packageDir,
        "--provenance-file",
        badPath,
        "--access",
        "public",
      );
      expect(err).toContain("does not match the package");
      expect(exitCode).toBe(1);
      expect(putBody).toBeNull();
    }

    // Subject match → attached under `_attachments["*.sigstore"]`. We need
    // the tarball's SHA-512 for the bundle's subject, so pack first, then
    // publish that exact tarball.
    {
      await using packProc = Bun.spawn({
        cmd: [bunExe(), "pm", "pack"],
        cwd: packageDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [packStderr, packExitCode] = await Promise.all([packProc.stderr.text(), packProc.exited]);
      if (packExitCode !== 0) expect(packStderr).toBe("");
      expect(packExitCode).toBe(0);
      const tarballPath = join(packageDir, "prov-pkg-6-2.0.0.tgz");
      const tarball = await Bun.file(tarballPath).arrayBuffer();
      const sha512 = Buffer.from(await crypto.subtle.digest("SHA-512", tarball)).toString("hex");

      const goodBundle = makeBundle("pkg:npm/prov-pkg-6@2.0.0", sha512);
      const goodPath = join(packageDir, "good.sigstore");
      const goodBundleJson = JSON.stringify(goodBundle);
      await write(goodPath, goodBundleJson);

      const { out, err, exitCode } = await publish(
        { ...bunEnv },
        packageDir,
        tarballPath,
        "--provenance-file",
        goodPath,
        "--access",
        "public",
      );
      expect(err).not.toContain("error:");
      expect(out + err).toContain("Attached provenance bundle");
      expect(exitCode).toBe(0);
      expect(putBody).not.toBeNull();
      const att = putBody._attachments["prov-pkg-6-2.0.0.sigstore"];
      expect(att).toBeDefined();
      expect(att.content_type).toBe("application/vnd.dev.sigstore.bundle+json;version=0.2");
      expect(att.data).toBe(goodBundleJson);
      expect(att.length).toBe(goodBundleJson.length);
    }
  });

  test("--provenance and --provenance-file are mutually exclusive", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 200 }),
    });
    const base = `http://localhost:${server.port}`;
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        `[install]\ncache = false\nregistry = { url = "${base}", token = "tok" }\n`,
      ),
      write(packageJson, JSON.stringify({ name: "prov-pkg-7", version: "1.0.0" })),
      write(join(packageDir, "x.sigstore"), "{}"),
    ]);
    const { err, exitCode } = await publish(
      { ...bunEnv },
      packageDir,
      "--provenance",
      "--provenance-file",
      join(packageDir, "x.sigstore"),
      "--access",
      "public",
    );
    expect(err).toContain("mutually exclusive");
    expect(exitCode).toBe(1);

    // …but `publishConfig.provenance: false` + `--provenance-file` is not a
    // conflict — npm checks `=== true`, not "is set". We should get past the
    // exclusion check and fail on bundle validation instead.
    await write(
      packageJson,
      JSON.stringify({
        name: "prov-pkg-7",
        version: "1.0.0",
        publishConfig: { provenance: false },
      }),
    );
    const { err: err2, exitCode: exitCode2 } = await publish(
      { ...bunEnv },
      packageDir,
      "--provenance-file",
      join(packageDir, "x.sigstore"),
      "--access",
      "public",
    );
    expect(err2).not.toContain("mutually exclusive");
    expect(exitCode2).toBe(1); // fails on bundle parse/validation, not exclusion
  });
});
