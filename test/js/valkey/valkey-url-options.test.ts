import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as localhostTls } from "harness";

// `url` and `options` are read back from the constructor input. No server is
// needed: the client is never connected.
describe("RedisClient url and options", () => {
  test("url returns the constructor input verbatim", () => {
    const url = "redis://user:pass@127.0.0.1:6380/3";
    const client = new RedisClient(url, { autoReconnect: false });
    expect(client.url).toBe(url);
    expect("url" in client).toBe(true);
    // A URL without a scheme is kept as given; the constructor adds valkey:// internally.
    expect(new RedisClient("127.0.0.1:6381", { autoReconnect: false }).url).toBe("127.0.0.1:6381");
  });

  test("options reports the defaults for a bare constructor", () => {
    const client = new RedisClient("redis://127.0.0.1:6380");
    expect(client.options).toEqual({
      connectionTimeout: 10000,
      idleTimeout: 0,
      autoReconnect: true,
      maxRetries: 20,
      enableOfflineQueue: true,
      enableAutoPipelining: true,
      tls: false,
    });
  });

  test("options reflects the values passed to the constructor", () => {
    const client = new RedisClient("redis://127.0.0.1:6380", {
      connectionTimeout: 1234,
      idleTimeout: 5000,
      autoReconnect: false,
      maxRetries: 3,
      enableOfflineQueue: false,
      enableAutoPipelining: false,
      tls: true,
    });
    expect(client.options).toEqual({
      connectionTimeout: 1234,
      idleTimeout: 5000,
      autoReconnect: false,
      maxRetries: 3,
      enableOfflineQueue: false,
      enableAutoPipelining: false,
      tls: true,
    });
  });

  test("options.tls is true for a rediss:// url with no tls option", () => {
    const client = new RedisClient("rediss://127.0.0.1:6380", { autoReconnect: false });
    expect(client.options.tls).toBe(true);
  });

  test("options.tls returns the tls object passed to the constructor", () => {
    const tls = { ca: localhostTls.cert, rejectUnauthorized: true };
    const client = new RedisClient("rediss://127.0.0.1:6380", { tls, autoReconnect: false });
    expect(client.options.tls).toBe(tls);

    // A client rebuilt from url and options keeps the same custom certificates.
    const rebuilt = new RedisClient(client.url, client.options);
    expect(rebuilt.url).toBe(client.url);
    expect(rebuilt.options).toEqual(client.options);
    expect(rebuilt.options.tls).toBe(tls);
  });

  test("duplicate() keeps url and options", async () => {
    const tls = { ca: localhostTls.cert };
    const url = "rediss://user:pass@127.0.0.1:6380/2";
    const client = new RedisClient(url, { tls, maxRetries: 7, autoReconnect: false });
    const copy = await client.duplicate();
    expect(copy).not.toBe(client);
    expect(copy.url).toBe(url);
    expect(copy.options).toEqual(client.options);
    expect(copy.options.tls).toBe(tls);
  });

  test("inspect redacts the password in url and does not print the tls object", () => {
    const tls = { ca: localhostTls.cert, key: "private key material" };
    const client = new RedisClient("rediss://user:secret@127.0.0.1:6380/2", {
      tls,
      autoReconnect: false,
    });
    const text = Bun.inspect(client);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("private key material");
    expect(text).toMatchInlineSnapshot(`
      "RedisClient {
        url: "rediss://user:[REDACTED]@127.0.0.1:6380/2",
        connected: false,
        bufferedAmount: 0,
        options: {
          connectionTimeout: 10000,
          idleTimeout: 0,
          autoReconnect: false,
          maxRetries: 20,
          enableOfflineQueue: true,
          enableAutoPipelining: true,
          tls: true,
        },
      }"
    `);
    // The getter itself is not redacted: a rebuild needs the password.
    expect(client.url).toBe("rediss://user:secret@127.0.0.1:6380/2");
  });

  test("inspect leaves a url without a password as is", () => {
    expect(Bun.inspect(new RedisClient("redis://user@127.0.0.1:6380", { autoReconnect: false }))).toContain(
      'url: "redis://user@127.0.0.1:6380"',
    );
    expect(Bun.inspect(new RedisClient("redis://127.0.0.1:6380/1?x=a@b", { autoReconnect: false }))).toContain(
      'url: "redis://127.0.0.1:6380/1?x=a@b"',
    );
    expect(Bun.inspect(new RedisClient("u:p@127.0.0.1:6380", { autoReconnect: false }))).toContain(
      'url: "u:[REDACTED]@127.0.0.1:6380"',
    );
  });

  test("url falls back to REDIS_URL, then VALKEY_URL, then the built-in default", async () => {
    const script = `
      console.log(JSON.stringify([
        new Bun.RedisClient().url,
        new Bun.RedisClient(undefined, { autoReconnect: false }).url,
        Bun.redis.url,
        Bun.redis.options.autoReconnect,
      ]));
    `;
    const run = async (env: Record<string, string | undefined>) => {
      const baseEnv = { ...bunEnv } as Record<string, string | undefined>;
      delete baseEnv.REDIS_URL;
      delete baseEnv.VALKEY_URL;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...baseEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    };

    expect(await run({ REDIS_URL: "redis://127.0.0.1:6390/1", VALKEY_URL: "valkey://127.0.0.1:6391" })).toEqual([
      "redis://127.0.0.1:6390/1",
      "redis://127.0.0.1:6390/1",
      "redis://127.0.0.1:6390/1",
      true,
    ]);
    expect(await run({ VALKEY_URL: "valkey://127.0.0.1:6391/4" })).toEqual([
      "valkey://127.0.0.1:6391/4",
      "valkey://127.0.0.1:6391/4",
      "valkey://127.0.0.1:6391/4",
      true,
    ]);
    expect(await run({})).toEqual([
      "valkey://localhost:6379",
      "valkey://localhost:6379",
      "valkey://localhost:6379",
      true,
    ]);
  });
});
