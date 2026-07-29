// fetch() referrer / referrerPolicy
// https://fetch.spec.whatwg.org/#dom-request-referrer
// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "path";
import {
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  laxTls,
  restoreProxyEnv,
} from "../../bun/http/proxy-stress-helpers";

// Each test binds its own server and reads only its own `received` map.
describe.concurrent("fetch referrer and referrerPolicy", () => {
  // Collect the Referer header each request arrives with, keyed by pathname.
  function referrerServer(received: Record<string, string | null>, options: { unix?: string } = {}) {
    return Bun.serve({
      ...(options.unix ? { unix: options.unix } : { port: 0 }),
      fetch(req) {
        received[new URL(req.url).pathname] = req.headers.get("referer");
        return new Response("ok");
      },
    });
  }

  it("Request.referrer and Request.referrerPolicy reflect the init options", () => {
    const url = "http://example.com/a";
    expect(new Request(url).referrer).toBe("about:client");
    expect(new Request(url).referrerPolicy).toBe("");
    expect(new Request(url, { referrer: "https://app.example/page" }).referrer).toBe("https://app.example/page");
    // the empty string means "no-referrer"
    expect(new Request(url, { referrer: "" }).referrer).toBe("");
    expect(new Request(url, { referrer: "about:client" }).referrer).toBe("about:client");
    expect(new Request(url, { referrerPolicy: "unsafe-url" }).referrerPolicy).toBe("unsafe-url");
    // the stored referrer is the normalized href (scheme/host lowercased, default port dropped)
    expect(new Request(url, { referrer: "HTTPS://App.Example:443/P" }).referrer).toBe("https://app.example/P");
  });

  it("Request constructor rejects an invalid referrer or referrerPolicy", () => {
    const url = "http://example.com/a";
    expect(() => new Request(url, { referrer: "ht tp://x" })).toThrow(/referrer/i);
    // there is no base URL to resolve a relative referrer against
    expect(() => new Request(url, { referrer: "/relative" })).toThrow(/referrer/i);
    // @ts-expect-error deliberately invalid enum value
    expect(() => new Request(url, { referrerPolicy: "bogus" })).toThrow(/referrerPolicy/);
  });

  it("referrer and referrerPolicy survive clone() and new Request(request)", () => {
    const original = new Request("http://example.com/a", {
      referrer: "https://app.example/p",
      referrerPolicy: "origin",
    });
    const cloned = original.clone();
    expect({ referrer: cloned.referrer, referrerPolicy: cloned.referrerPolicy }).toEqual({
      referrer: "https://app.example/p",
      referrerPolicy: "origin",
    });
    const rewrapped = new Request(original);
    expect({ referrer: rewrapped.referrer, referrerPolicy: rewrapped.referrerPolicy }).toEqual({
      referrer: "https://app.example/p",
      referrerPolicy: "origin",
    });
    // an init override wins over the source request's value
    expect(new Request(original, { referrerPolicy: "no-referrer" }).referrerPolicy).toBe("no-referrer");
    expect(new Request(original, { referrer: "https://other.example/q" }).referrer).toBe("https://other.example/q");
  });

  // The target (127.0.0.1) is potentially trustworthy, so none of these are a
  // downgrade; the referrer is cross-origin with the target.
  it("fetch() sends the Referer header per the referrer policy", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;
    const referrer = "https://app.example/page?q=1#frag";

    await fetch(`${base}/no-referrer`, { referrer, referrerPolicy: "no-referrer" });
    await fetch(`${base}/no-referrer-when-downgrade`, { referrer, referrerPolicy: "no-referrer-when-downgrade" });
    await fetch(`${base}/origin`, { referrer, referrerPolicy: "origin" });
    await fetch(`${base}/origin-when-cross-origin`, { referrer, referrerPolicy: "origin-when-cross-origin" });
    await fetch(`${base}/same-origin`, { referrer, referrerPolicy: "same-origin" });
    await fetch(`${base}/strict-origin`, { referrer, referrerPolicy: "strict-origin" });
    await fetch(`${base}/strict-origin-when-cross-origin`, {
      referrer,
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    await fetch(`${base}/unsafe-url`, { referrer, referrerPolicy: "unsafe-url" });
    // the empty policy resolves to strict-origin-when-cross-origin
    await fetch(`${base}/default`, { referrer, referrerPolicy: "" });
    await fetch(`${base}/unset`, { referrer });

    // Credentials and the fragment are always stripped for the Referer header.
    expect(received).toEqual({
      "/no-referrer": null,
      "/no-referrer-when-downgrade": "https://app.example/page?q=1",
      "/origin": "https://app.example/",
      "/origin-when-cross-origin": "https://app.example/",
      "/same-origin": null,
      "/strict-origin": "https://app.example/",
      "/strict-origin-when-cross-origin": "https://app.example/",
      "/unsafe-url": "https://app.example/page?q=1",
      "/default": "https://app.example/",
      "/unset": "https://app.example/",
    });
  });

  it("fetch() sends the full referrer when it is same-origin with the target", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;
    const referrer = `${base}/other?z=1`;

    await fetch(`${base}/socwo`, { referrer, referrerPolicy: "strict-origin-when-cross-origin" });
    await fetch(`${base}/same-origin`, { referrer, referrerPolicy: "same-origin" });
    await fetch(`${base}/owco`, { referrer, referrerPolicy: "origin-when-cross-origin" });

    expect(received).toEqual({
      "/socwo": referrer,
      "/same-origin": referrer,
      "/owco": referrer,
    });
  });

  it("fetch() sends no Referer for a client, no-referrer, or local-scheme referrer", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;

    // no referrer option: the default "about:client" has nothing to resolve to
    await fetch(`${base}/none`);
    await fetch(`${base}/policy-only`, { referrerPolicy: "unsafe-url" });
    // the empty string is the spec's "no-referrer"
    await fetch(`${base}/empty`, { referrer: "", referrerPolicy: "unsafe-url" });
    await fetch(`${base}/client`, { referrer: "about:client", referrerPolicy: "unsafe-url" });
    // local schemes are stripped to "no referrer"
    await fetch(`${base}/blank`, { referrer: "about:blank", referrerPolicy: "unsafe-url" });
    await fetch(`${base}/data`, { referrer: "data:text/plain,hi", referrerPolicy: "unsafe-url" });
    // both blob: forms: bun's own object URLs and the browser origin form
    await fetch(`${base}/blob`, {
      referrer: "blob:550e8400-e29b-41d4-a716-446655440000",
      referrerPolicy: "unsafe-url",
    });
    await fetch(`${base}/blob-origin`, {
      referrer: "blob:https://origin.example/550e8400-e29b-41d4-a716-446655440000",
      referrerPolicy: "unsafe-url",
    });

    expect(received).toEqual({
      "/none": null,
      "/policy-only": null,
      "/empty": null,
      "/client": null,
      "/blank": null,
      "/data": null,
      "/blob": null,
      "/blob-origin": null,
    });
  });

  it("fetch() strips credentials and caps an over-long referrer to its origin", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/cred`, {
      referrer: "https://user:pw@app.example:8443/a/b?x=1#f",
      referrerPolicy: "unsafe-url",
    });
    // a username with no password, with and without a port
    await fetch(`${base}/user-port`, {
      referrer: "https://alice@app.example:8443/a/b",
      referrerPolicy: "unsafe-url",
    });
    await fetch(`${base}/user-only`, { referrer: "https://alice@app.example/a/b", referrerPolicy: "unsafe-url" });
    // a stripped referrer longer than 4096 falls back to the origin
    await fetch(`${base}/long`, {
      referrer: "https://app.example/" + Buffer.alloc(5000, "a").toString(),
      referrerPolicy: "unsafe-url",
    });

    expect(received).toEqual({
      "/cred": "https://app.example:8443/a/b?x=1",
      "/user-port": "https://app.example:8443/a/b",
      "/user-only": "https://app.example/a/b",
      "/long": "https://app.example/",
    });
  });

  // A Referer must never displace the Content-Type that fetch() derives from
  // the body when the caller passed no headers of their own.
  it("fetch() keeps the body-derived Content-Type when it sends a Referer", async () => {
    const received: Record<string, string | null> = {};
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        received[new URL(req.url).pathname] = req.headers.get("content-type");
        return new Response("ok");
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const referrer = "https://app.example/page";
    const blob = () => new Blob(["{}"], { type: "application/json" });
    const formData = () => {
      const form = new FormData();
      form.append("k", "v");
      return form;
    };

    await fetch(`${base}/form-data`, { method: "POST", body: formData(), referrer, referrerPolicy: "unsafe-url" });
    await fetch(`${base}/blob`, { method: "POST", body: blob(), referrer, referrerPolicy: "unsafe-url" });
    // the same requests with no referrer, as the baseline
    await fetch(`${base}/form-data-baseline`, { method: "POST", body: formData() });
    await fetch(`${base}/blob-baseline`, { method: "POST", body: blob() });

    // the multipart boundary is random per request, so compare only the rest
    expect(received["/form-data"]).toStartWith("multipart/form-data; boundary=");
    expect(received["/form-data"]?.replace(/boundary=.*$/, "")).toBe(
      received["/form-data-baseline"]!.replace(/boundary=.*$/, ""),
    );
    expect(received["/blob"]).toStartWith("application/json");
    expect(received["/blob"]).toBe(received["/blob-baseline"]);
  });

  it("an explicit Referer header wins over the referrer option", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/both`, {
      headers: { referer: "https://manual.example/" },
      referrer: "https://auto.example/x",
      referrerPolicy: "unsafe-url",
    });
    await fetch(`${base}/header-only`, { headers: { referer: "https://manual.example/" } });

    expect(received).toEqual({
      "/both": "https://manual.example/",
      "/header-only": "https://manual.example/",
    });
  });

  it("fetch() honors the referrer of a Request argument and lets init override it", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;

    await fetch(
      new Request(`${base}/from-request`, { referrer: "https://app.example/r", referrerPolicy: "unsafe-url" }),
    );
    await fetch(new Request(`${base}/override`, { referrer: "https://app.example/r", referrerPolicy: "unsafe-url" }), {
      referrerPolicy: "no-referrer",
    });

    expect(received).toEqual({
      "/from-request": "https://app.example/r",
      "/override": null,
    });
  });

  // The strict/downgrade branches need a target URL that is NOT potentially
  // trustworthy (https/wss/file, localhost, 127.*, [::1]). A unix socket lets
  // the request URL carry an arbitrary non-loopback hostname while the
  // connection still reaches a local server.
  it("strict policies drop the Referer on a trustworthy -> untrustworthy downgrade", async () => {
    const received: Record<string, string | null> = {};
    const unix = join(tmpdirSync(), "fetch-referrer.sock");
    await using server = referrerServer(received, { unix });
    const referrer = "https://secure.example/page?q=1";
    const base = "http://insecure.example";

    await fetch(`${base}/nrwd`, { unix, referrer, referrerPolicy: "no-referrer-when-downgrade" });
    await fetch(`${base}/strict-origin`, { unix, referrer, referrerPolicy: "strict-origin" });
    await fetch(`${base}/socwo`, { unix, referrer, referrerPolicy: "strict-origin-when-cross-origin" });
    // a domain whose first label is "127" is not an IPv4 loopback, so this is
    // still a downgrade
    await fetch(`http://127.example.com/domain-127`, { unix, referrer, referrerPolicy: "strict-origin" });
    // the non-strict equivalents still send it
    await fetch(`${base}/origin`, { unix, referrer, referrerPolicy: "origin" });
    await fetch(`${base}/unsafe-url`, { unix, referrer, referrerPolicy: "unsafe-url" });

    expect(received).toEqual({
      "/nrwd": null,
      "/strict-origin": null,
      "/socwo": null,
      "/domain-127": null,
      "/origin": "https://secure.example/",
      "/unsafe-url": "https://secure.example/page?q=1",
    });
  });

  // A real 127/8 loopback target IS potentially trustworthy, so an https
  // referrer is not a downgrade and the strict policies still send it.
  it("an IPv4 loopback target is potentially trustworthy", async () => {
    const received: Record<string, string | null> = {};
    await using server = referrerServer(received);
    const base = `http://127.0.0.1:${server.port}`;
    const referrer = "https://secure.example/page?q=1";

    await fetch(`${base}/strict-origin`, { referrer, referrerPolicy: "strict-origin" });
    await fetch(`${base}/nrwd`, { referrer, referrerPolicy: "no-referrer-when-downgrade" });

    expect(received).toEqual({
      "/strict-origin": "https://secure.example/",
      "/nrwd": "https://secure.example/page?q=1",
    });
  });

  // The Referer header is computed per hop, so a redirect to a different
  // origin applies the referrer policy against that hop's URL.
  // https://fetch.spec.whatwg.org/#http-redirect-fetch
  describe("redirects", () => {
    // Two servers on different ports = two origins. A redirects to itself
    // (same-origin) or to B (cross-origin). An optional `referrer-policy` key
    // sets that response header on the redirect.
    function redirectServers(hops: Record<string, string | null>) {
      const B = Bun.serve({
        port: 0,
        fetch(req) {
          hops["B " + new URL(req.url).search] = req.headers.get("referer");
          return new Response("ok");
        },
      });
      const A = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          hops["A " + url.search] = req.headers.get("referer");
          const target = url.pathname.slice(1);
          const redirectHeaders: Record<string, string> = {};
          const policy = url.searchParams.get("respond-policy");
          if (policy !== null) redirectHeaders["referrer-policy"] = policy;
          if (target === "same") {
            return Response.redirect(`http://127.0.0.1:${A.port}/landed${url.search}`, {
              status: 302,
              headers: redirectHeaders,
            });
          }
          if (target === "cross") {
            return Response.redirect(`http://127.0.0.1:${B.port}/landed${url.search}`, {
              status: 302,
              headers: redirectHeaders,
            });
          }
          return new Response("ok");
        },
      });
      return { A, B, urlA: `http://127.0.0.1:${A.port}` };
    }

    it("fetch() recomputes the Referer header on each redirect hop", async () => {
      const hops: Record<string, string | null> = {};
      const { A, B, urlA } = redirectServers(hops);
      await using _a = A;
      await using _b = B;

      // With the default policy, a referrer that is same-origin with A sends
      // the full URL to A but only its origin to B (the cross-origin hop). On
      // the unpatched path the initial Referer would be re-sent verbatim.
      await fetch(`${urlA}/cross?c=per-hop`, { referrer: `${urlA}/page?x=1` });
      // unsafe-url: the full URL on every hop
      await fetch(`${urlA}/cross?c=unsafe`, { referrer: `${urlA}/page?x=1`, referrerPolicy: "unsafe-url" });
      // same-origin: A gets the full URL, B gets nothing
      await fetch(`${urlA}/cross?c=same-origin`, { referrer: `${urlA}/page?x=1`, referrerPolicy: "same-origin" });
      // origin: both hops get only the origin
      await fetch(`${urlA}/cross?c=origin`, {
        referrer: "https://app.example/page?x=1",
        referrerPolicy: "origin",
      });

      expect(hops).toEqual({
        "A ?c=per-hop": `${urlA}/page?x=1`,
        "B ?c=per-hop": `${urlA}/`,
        "A ?c=unsafe": `${urlA}/page?x=1`,
        "B ?c=unsafe": `${urlA}/page?x=1`,
        "A ?c=same-origin": `${urlA}/page?x=1`,
        "B ?c=same-origin": null,
        "A ?c=origin": "https://app.example/",
        "B ?c=origin": "https://app.example/",
      });
    });

    it("fetch() applies a Referrer-Policy response header to subsequent hops", async () => {
      const hops: Record<string, string | null> = {};
      const { A, B, urlA } = redirectServers(hops);
      await using _a = A;
      await using _b = B;
      const referrer = "https://app.example/page?x=1";

      // the redirect response's Referrer-Policy overrides the request's
      await fetch(`${urlA}/cross?c=set-none&respond-policy=no-referrer`, {
        referrer,
        referrerPolicy: "unsafe-url",
      });
      await fetch(`${urlA}/cross?c=set-unsafe&respond-policy=unsafe-url`, {
        referrer,
        referrerPolicy: "origin",
      });
      // an unrecognized token is ignored (policy stays unsafe-url)
      await fetch(`${urlA}/cross?c=bad&respond-policy=bogus`, {
        referrer,
        referrerPolicy: "unsafe-url",
      });
      // a comma-separated list: the last valid non-empty token wins
      const list = encodeURIComponent("bogus, no-referrer, ");
      await fetch(`${urlA}/cross?c=list&respond-policy=${list}`, {
        referrer,
        referrerPolicy: "unsafe-url",
      });

      expect(hops).toEqual({
        "A ?c=set-none&respond-policy=no-referrer": referrer,
        "B ?c=set-none&respond-policy=no-referrer": null,
        "A ?c=set-unsafe&respond-policy=unsafe-url": "https://app.example/",
        "B ?c=set-unsafe&respond-policy=unsafe-url": referrer,
        "A ?c=bad&respond-policy=bogus": referrer,
        "B ?c=bad&respond-policy=bogus": referrer,
        [`A ?c=list&respond-policy=${list}`]: referrer,
        [`B ?c=list&respond-policy=${list}`]: null,
      });
    });

    it("an explicit Referer header is forwarded verbatim across redirects", async () => {
      const hops: Record<string, string | null> = {};
      const { A, B, urlA } = redirectServers(hops);
      await using _a = A;
      await using _b = B;

      // user-set Referer passes through both hops unchanged (parity with Node)
      await fetch(`${urlA}/cross?c=user`, { headers: { referer: "https://manual.example/set-by-user" } });
      // and a Referrer-Policy response header does not touch it
      await fetch(`${urlA}/cross?c=user-policy&respond-policy=no-referrer`, {
        headers: { referer: "https://manual.example/set-by-user" },
      });

      expect(hops).toEqual({
        "A ?c=user": "https://manual.example/set-by-user",
        "B ?c=user": "https://manual.example/set-by-user",
        "A ?c=user-policy&respond-policy=no-referrer": "https://manual.example/set-by-user",
        "B ?c=user-policy&respond-policy=no-referrer": "https://manual.example/set-by-user",
      });
    });

    it("fetch() sends no Referer on any redirect hop when none was computed for the first", async () => {
      const hops: Record<string, string | null> = {};
      const { A, B, urlA } = redirectServers(hops);
      await using _a = A;
      await using _b = B;

      // no referrer option: "about:client" yields no Referer on any hop
      await fetch(`${urlA}/cross?c=none`);

      expect(hops).toEqual({
        "A ?c=none": null,
        "B ?c=none": null,
      });
    });
  });
});

// A proxy's CONNECT reply must not influence the referrer policy of the
// tunneled request: the Referrer-Policy response header only applies on a
// redirect (fetch spec HTTP-redirect fetch, step 19), and a CONNECT 200 is
// not one. Isolated from the concurrent block so clearProxyEnv cannot race.
describe("fetch referrer through a CONNECT proxy", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeAll(() => {
    savedEnv = clearProxyEnv();
  });
  afterAll(() => {
    restoreProxyEnv(savedEnv);
  });

  it("ignores a Referrer-Policy header on the proxy's CONNECT reply", async () => {
    await using origin = await createAdversarialOrigin({ tls: true });
    await using proxy = await createAdversarialProxy({
      connectReplyHeaders: { "Referrer-Policy": "unsafe-url" },
    });

    // the caller's no-referrer policy must survive the tunnel intact
    const res = await fetch(origin.url, {
      proxy: proxy.url,
      tls: laxTls,
      referrer: "https://app.example/secret?token=xyz",
      referrerPolicy: "no-referrer",
    });
    expect(await res.text()).toBe("ok");
    expect(origin.requests[0].headers["referer"]).toBeUndefined();

    // and unsafe-url still works end to end through the same tunnel setup
    await using origin2 = await createAdversarialOrigin({ tls: true });
    const res2 = await fetch(origin2.url, {
      proxy: proxy.url,
      tls: laxTls,
      referrer: "https://app.example/secret?token=xyz",
      referrerPolicy: "unsafe-url",
    });
    expect(await res2.text()).toBe("ok");
    expect(origin2.requests[0].headers["referer"]).toBe("https://app.example/secret?token=xyz");
  });
});
