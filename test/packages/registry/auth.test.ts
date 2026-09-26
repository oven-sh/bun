import { describe, expect, test } from "bun:test";
import { jsonHeaders, pack, publishBody, request } from "./fixtures.ts";
import { Registry } from "./index.ts";

const otpMessage = "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.";

function login(registry: Registry, name: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return request(`${registry.url}-/user/org.couchdb.user:${name}`, {
    method: "PUT",
    headers: { ...jsonHeaders(), ...headers },
    body: JSON.stringify({ _id: `org.couchdb.user:${name}`, name, type: "user", roles: [], ...body }),
  });
}

describe("adduser and login", () => {
  test("a new user gets a token", async () => {
    using registry = new Registry().start();
    const reply = await login(registry, "alice", { password: "secret", email: "alice@example.com" });
    expect(reply.status).toBe(201);
    expect(reply.json).toEqual({
      ok: true,
      id: "org.couchdb.user:alice",
      rev: "_we_dont_use_revs_any_more",
      token: expect.stringMatching(/^npm_[0-9A-Za-z]{36}$/),
    });
    expect(reply.headers["cache-control"]).toBe("no-cache, no-store");

    const whoami = await request(`${registry.url}-/whoami`, { headers: jsonHeaders(reply.json.token) });
    expect(whoami).toMatchObject({ status: 200, json: { username: "alice" } });
  });

  test("a user that exists logs in with the password", async () => {
    using registry = new Registry().start();
    const created = await login(registry, "bob", { password: "secret", email: "bob@example.com" });
    // `npm login` sends no email.
    const again = await login(registry, "bob", { password: "secret" });
    expect(again.status).toBe(201);
    expect(again.json.token).not.toBe(created.json.token);
    for (const { json } of [created, again]) {
      const whoami = await request(`${registry.url}-/whoami`, { headers: jsonHeaders(json.token) });
      expect(whoami.json).toEqual({ username: "bob" });
    }
  });

  test("failures", async () => {
    using registry = new Registry().start();
    await login(registry, "carol", { password: "secret", email: "carol@example.com" });

    const wrongPassword = await login(registry, "carol", { password: "wrong" });
    expect(wrongPassword).toMatchObject({ status: 401, json: { ok: false } });

    const unknown = await login(registry, "nobody", { password: "secret" });
    expect(unknown).toMatchObject({
      status: 400,
      json: { error: `There is no user with the username "nobody".` },
    });

    const otherName = await request(`${registry.url}-/user/org.couchdb.user:dave`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "erin", password: "secret", email: "erin@example.com" }),
    });
    expect(otherName.status).toBe(400);

    const noPassword = await login(registry, "frank", { email: "frank@example.com" });
    expect(noPassword.status).toBe(400);

    const notJson = await request(`${registry.url}-/user/org.couchdb.user:grace`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "grace", password: "secret", email: "grace@example.com" }),
    });
    expect(notJson.status).toBe(415);

    const broken = await request(`${registry.url}-/user/org.couchdb.user:grace`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: "{",
    });
    expect(broken.status).toBe(400);
    expect([...registry.auth.users.keys()]).toEqual(["carol"]);
  });

  test("logout removes the token", async () => {
    using registry = new Registry().start();
    const { token } = registry.auth.createToken(registry.auth.addUser("heidi", "secret"));
    const other = registry.auth.createToken(registry.auth.addUser("ivan", "secret")).token;

    // A user cannot remove the token of another user.
    const foreign = await request(`${registry.url}-/user/token/${token}`, {
      method: "DELETE",
      headers: jsonHeaders(other),
    });
    expect(foreign.status).toBe(404);

    const reply = await request(`${registry.url}-/user/token/${token}`, {
      method: "DELETE",
      headers: jsonHeaders(token),
    });
    expect(reply).toMatchObject({ status: 200, json: { ok: true } });
    const whoami = await request(`${registry.url}-/whoami`, { headers: jsonHeaders(token) });
    expect(whoami.status).toBe(401);
  });
});

describe("whoami", () => {
  test("tells a client without credentials from a client with wrong ones", async () => {
    using registry = new Registry().start();
    registry.auth.addUser("judy", "secret");

    const none = await request(`${registry.url}-/whoami`);
    expect({ status: none.status, body: none.text }).toEqual({ status: 401, body: `{"error":"Unauthorized"}` });
    // The registry does not ask for a scheme.
    expect(none.headers).not.toHaveProperty("www-authenticate");

    for (const authorization of ["Bearer npm_000000000000000000000000000000000000", "Basic anVkeTp3cm9uZw==", "x"]) {
      const reply = await request(`${registry.url}-/whoami`, { headers: { authorization } });
      expect({ status: reply.status, body: reply.text }).toEqual({ status: 401, body: "{}" });
    }

    const basic = await request(`${registry.url}-/whoami`, {
      headers: { authorization: `Basic ${btoa("judy:secret")}` },
    });
    expect(basic).toMatchObject({ status: 200, json: { username: "judy" } });
  });

  test("npm-notice goes to a client that is logged in", async () => {
    using registry = new Registry({ notice: "Please rotate your token." }).start();
    const { token } = registry.auth.createToken(registry.auth.addUser("kim", "secret"));
    const reply = await request(`${registry.url}-/whoami`, { headers: jsonHeaders(token) });
    expect(reply.headers["npm-notice"]).toBe("Please rotate your token.");
    expect((await request(`${registry.url}-/ping`)).headers).not.toHaveProperty("npm-notice");
  });
});

describe("tokens and profile", () => {
  test("create, list and delete", async () => {
    using registry = new Registry().start();
    const first = registry.auth.createToken(registry.auth.addUser("lee", "secret"));
    const endpoint = `${registry.url}-/npm/v1/tokens`;

    const wrong = await request(endpoint, {
      method: "POST",
      headers: jsonHeaders(first.token),
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(wrong.status).toBe(401);

    const created = await request(endpoint, {
      method: "POST",
      headers: jsonHeaders(first.token),
      body: JSON.stringify({ password: "secret", readonly: true, cidr_whitelist: ["10.0.0.0/8"] }),
    });
    expect(created.status).toBe(200);
    expect(created.json).toEqual({
      token: expect.stringMatching(/^npm_[0-9A-Za-z]{36}$/),
      key: new Bun.CryptoHasher("sha512").update(created.json.token).digest("hex"),
      cidr_whitelist: ["10.0.0.0/8"],
      readonly: true,
      automation: false,
      created: expect.any(String),
      updated: expect.any(String),
    });

    const listed = await request(endpoint, { headers: jsonHeaders(first.token) });
    expect(listed.json.total).toBe(2);
    expect(listed.json.urls).toEqual({});
    expect(listed.json.objects.map((token: any) => token.key)).toEqual([first.key, created.json.key]);
    // The value of a token is shown once, when it is created.
    expect(JSON.stringify(listed.json)).not.toContain(created.json.token);

    const page = await request(`${endpoint}?perPage=1`, { headers: jsonHeaders(first.token) });
    expect(page.json.objects).toHaveLength(1);
    expect(page.json.urls).toEqual({ next: `${endpoint}?page=1&perPage=1` });
    expect((await request(`${endpoint}?page=9`, { headers: jsonHeaders(first.token) })).status).toBe(400);

    const removed = await request(`${endpoint}/token/${created.json.key}`, {
      method: "DELETE",
      headers: jsonHeaders(first.token),
    });
    expect({ status: removed.status, body: removed.text }).toEqual({ status: 204, body: "" });
    expect((await request(`${registry.url}-/whoami`, { headers: jsonHeaders(created.json.token) })).status).toBe(401);
    expect((await request(endpoint)).status).toBe(401);
  });

  test("a read-only token reads and does not write", async () => {
    using registry = new Registry().start();
    const user = registry.auth.addUser("mallory", "secret");
    const { token } = registry.auth.createToken(user, { readonly: true });
    expect((await request(`${registry.url}-/whoami`, { headers: jsonHeaders(token) })).status).toBe(200);

    const manifest = { name: "read-only", version: "1.0.0" };
    const reply = await request(`${registry.url}read-only`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify(publishBody(manifest, await pack(manifest))),
    });
    expect(reply.status).toBe(403);
    expect(await registry.packages.has("read-only")).toBe(false);
  });

  test("profile", async () => {
    using registry = new Registry().start();
    const user = registry.auth.addUser("nina", "secret", { email: "nina@example.com", tfa: "auth-only", otp: ["1"] });
    const { token } = registry.auth.createToken(user);
    const endpoint = `${registry.url}-/npm/v1/user`;

    const profile = await request(endpoint, { headers: jsonHeaders(token) });
    expect(profile.json).toEqual({
      tfa: { pending: false, mode: "auth-only" },
      name: "nina",
      email: "nina@example.com",
      email_verified: true,
      created: user.created.toISOString(),
      updated: user.updated.toISOString(),
      cidr_whitelist: null,
      fullname: "",
    });
    expect((await request(endpoint)).status).toBe(401);

    const renamed = await request(endpoint, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ fullname: "Nina N." }),
    });
    expect(renamed.json.fullname).toBe("Nina N.");

    // A new password needs the old one, and the one-time password of a user with two-factor authentication.
    const change = (headers: Record<string, string>, old = "secret") =>
      request(endpoint, {
        method: "POST",
        headers: { ...jsonHeaders(token), ...headers },
        body: JSON.stringify({ password: { old, new: "changed" } }),
      });
    expect((await change({}, "wrong")).status).toBe(401);
    expect(await change({})).toMatchObject({ status: 401, headers: { "www-authenticate": "OTP" } });
    expect((await change({ "npm-otp": "1" })).status).toBe(200);
    expect(registry.auth.verifyPassword(user, "changed")).toBe(true);
  });
});

describe("one-time passwords", () => {
  async function setup() {
    const registry = new Registry().start();
    const user = registry.auth.addUser("olga", "secret", { tfa: "auth-and-writes", otp: ["123456"] });
    const { token } = registry.auth.createToken(user);
    const manifest = { name: "guarded", version: "1.0.0" };
    const body = JSON.stringify(publishBody(manifest, await pack(manifest)));
    const publish = (headers: Record<string, string> = {}, bearer = token) =>
      request(`${registry.url}guarded`, { method: "PUT", headers: { ...jsonHeaders(bearer), ...headers }, body });
    return { registry, user, token, publish };
  }

  test("a write needs the code", async () => {
    const { registry, publish } = await setup();
    using _ = registry;

    const withoutTheCode: Record<string, string>[] = [{}, { "npm-otp": "000000" }];
    for (const headers of withoutTheCode) {
      const refused = await publish(headers);
      expect(refused.status).toBe(401);
      expect(refused.headers["www-authenticate"]).toBe("OTP");
      expect(refused.json).toEqual({ error: otpMessage });
    }
    expect(await registry.packages.has("guarded")).toBe(false);

    expect((await publish({ "npm-otp": "123456" })).status).toBe(200);
    expect(await registry.packages.has("guarded")).toBe(true);
  });

  test("a read does not need the code", async () => {
    const { registry, token } = await setup();
    using _ = registry;
    expect((await request(`${registry.url}-/whoami`, { headers: jsonHeaders(token) })).status).toBe(200);
  });

  test("an automation token passes", async () => {
    const { registry, user, publish } = await setup();
    using _ = registry;
    const automation = registry.auth.createToken(user, { automation: true }).token;
    expect((await publish({}, automation)).status).toBe(200);
  });

  test("the web flow hands out a code for one write", async () => {
    const { registry, publish } = await setup();
    using _ = registry;
    const origin = registry.url.slice(0, -1);

    const refused = await publish({ "npm-auth-type": "web" });
    expect(refused.status).toBe(401);
    expect(refused.headers["www-authenticate"]).toBe("OTP");
    expect(refused.json).toEqual({
      error: otpMessage,
      authUrl: expect.stringMatching(new RegExp(`^${origin}/-/v1/auth/cli/[0-9a-f-]{36}$`)),
      doneUrl: expect.stringMatching(new RegExp(`^${origin}/-/v1/done\\?authId=[0-9a-f-]{36}$`)),
    });

    const waiting = await request(refused.json.doneUrl);
    expect(waiting).toMatchObject({ status: 202, headers: { "retry-after": "1" } });

    // The user opens authUrl in a browser and logs in there.
    const approved = await request(refused.json.authUrl, {
      headers: { authorization: `Basic ${btoa("olga:secret")}` },
    });
    expect(approved.status).toBe(200);

    const done = await request(refused.json.doneUrl);
    expect(done.status).toBe(200);
    expect(done.json).toEqual({ token: expect.any(String) });

    expect((await publish({ "npm-otp": done.json.token, "npm-auth-type": "legacy" })).status).toBe(200);
    // The code does not work a second time.
    registry.packages.delete("guarded");
    expect((await publish({ "npm-otp": done.json.token })).status).toBe(401);
  });

  test("a login needs the code", async () => {
    const { registry } = await setup();
    using _ = registry;
    const refused = await login(registry, "olga", { password: "secret" });
    expect(refused).toMatchObject({ status: 401, headers: { "www-authenticate": "OTP" } });
    const accepted = await login(registry, "olga", { password: "secret" }, { "npm-otp": "123456" });
    expect(accepted.status).toBe(201);
  });
});

describe("web login", () => {
  test("the client waits until the user approves", async () => {
    using registry = new Registry().start();
    registry.auth.addUser("peggy", "secret");
    const origin = registry.url.slice(0, -1);

    const opened = await request(`${registry.url}-/v1/login`, {
      method: "POST",
      headers: jsonHeaders(),
      body: "{}",
    });
    expect(opened.status).toBe(200);
    expect(opened.json).toEqual({
      loginUrl: expect.stringMatching(new RegExp(`^${origin}/-/v1/login/cli/[0-9a-f-]{36}$`)),
      doneUrl: expect.stringMatching(new RegExp(`^${origin}/-/v1/done\\?sessionId=[0-9a-f-]{36}$`)),
    });

    expect((await request(opened.json.doneUrl)).status).toBe(202);
    // The page refuses a visitor that is not logged in.
    expect((await request(opened.json.loginUrl)).status).toBe(401);
    expect((await request(opened.json.doneUrl)).status).toBe(202);

    const sessionId = new URL(opened.json.doneUrl).searchParams.get("sessionId")!;
    registry.auth.approveSession(sessionId, "peggy");

    const done = await request(opened.json.doneUrl);
    expect(done.status).toBe(200);
    const whoami = await request(`${registry.url}-/whoami`, { headers: jsonHeaders(done.json.token) });
    expect(whoami.json).toEqual({ username: "peggy" });

    // The token is handed out once.
    expect((await request(opened.json.doneUrl)).status).toBe(404);
    expect((await request(`${registry.url}-/v1/done?sessionId=unknown`)).status).toBe(404);
  });
});
