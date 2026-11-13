import assert from "assert";
import { AsyncLocalStorage, AsyncResource, asyncWrapProviders } from "async_hooks";

test("node async_hooks.AsyncLocalStorage enable disable", async done => {
  const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

  asyncLocalStorage.run(new Map(), () => {
    asyncLocalStorage.getStore()!.set("foo", "bar");
    process.nextTick(() => {
      assert.strictEqual(asyncLocalStorage.getStore()!.get("foo"), "bar");
      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });

      asyncLocalStorage.disable();
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      // Calls to exit() should not mess with enabled status
      asyncLocalStorage.exit(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
        asyncLocalStorage.run(new Map().set("bar", "foo"), () => {
          assert.strictEqual(asyncLocalStorage.getStore()!.get("bar"), "foo");
          done();
        });
      });
    });
  });
});

test("node async_hooks.AsyncLocalStorage enable disable multiple times", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();

  asyncLocalStorage.enterWith("first value");
  expect(asyncLocalStorage.getStore()).toBe("first value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  asyncLocalStorage.enterWith("second value");
  expect(asyncLocalStorage.getStore()).toBe("second value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  const { promise, resolve, reject } = Promise.withResolvers();
  asyncLocalStorage.run("first run value", () => {
    try {
      expect(asyncLocalStorage.getStore()).toBe("first run value");
      asyncLocalStorage.disable();
      expect(asyncLocalStorage.getStore()).toBe(undefined);
      asyncLocalStorage.run("second run value", () => {
        try {
          expect(asyncLocalStorage.getStore()).toBe("second run value");
          asyncLocalStorage.disable();
          expect(asyncLocalStorage.getStore()).toBe(undefined);

          resolve(undefined);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });

  await promise;
});

test("AsyncResource.prototype.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let ar!: AsyncResource;
  localStorage.run(true, () => {
    ar = new AsyncResource("test");
  });
  expect(ar.bind(() => localStorage.getStore())()).toBe(true);
});

test("AsyncResource.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let fn!: () => true | undefined;
  localStorage.run(true, () => {
    fn = AsyncResource.bind(() => localStorage.getStore());
  });
  expect(fn()).toBe(true);
});

describe("asyncWrapProviders", () => {
  // `node -p "require('async_hooks').asyncWrapProviders"` on Node v26.3.0
  // (the NODE_ASYNC_PROVIDER_TYPES enum in node's src/async_wrap.h).
  const nodeProviders = {
    NONE: 0,
    DIRHANDLE: 1,
    DNSCHANNEL: 2,
    ELDHISTOGRAM: 3,
    FILEHANDLE: 4,
    FILEHANDLECLOSEREQ: 5,
    BLOBREADER: 6,
    FSEVENTWRAP: 7,
    FSREQCALLBACK: 8,
    FSREQPROMISE: 9,
    GETADDRINFOREQWRAP: 10,
    GETNAMEINFOREQWRAP: 11,
    HEAPSNAPSHOT: 12,
    HTTP2SESSION: 13,
    HTTP2STREAM: 14,
    HTTP2PING: 15,
    HTTP2SETTINGS: 16,
    HTTPINCOMINGMESSAGE: 17,
    HTTPCLIENTREQUEST: 18,
    LOCKS: 19,
    JSSTREAM: 20,
    JSUDPWRAP: 21,
    MESSAGEPORT: 22,
    PIPECONNECTWRAP: 23,
    PIPESERVERWRAP: 24,
    PIPEWRAP: 25,
    PROCESSWRAP: 26,
    PROMISE: 27,
    QUERYWRAP: 28,
    QUIC_ENDPOINT: 29,
    QUIC_LOGSTREAM: 30,
    QUIC_SESSION: 31,
    QUIC_STREAM: 32,
    QUIC_UDP: 33,
    SHUTDOWNWRAP: 34,
    SIGNALWRAP: 35,
    STATWATCHER: 36,
    STREAMPIPE: 37,
    TCPCONNECTWRAP: 38,
    TCPSERVERWRAP: 39,
    TCPWRAP: 40,
    TTYWRAP: 41,
    UDPSENDWRAP: 42,
    UDPWRAP: 43,
    SIGINTWATCHDOG: 44,
    WORKER: 45,
    WORKERCPUPROFILE: 46,
    WORKERCPUUSAGE: 47,
    WORKERHEAPPROFILE: 48,
    WORKERHEAPSNAPSHOT: 49,
    WORKERHEAPSTATISTICS: 50,
    WRITEWRAP: 51,
    ZLIB: 52,
    CHECKPRIMEREQUEST: 53,
    PBKDF2REQUEST: 54,
    KEYPAIRGENREQUEST: 55,
    KEYGENREQUEST: 56,
    KEYEXPORTREQUEST: 57,
    ARGON2REQUEST: 58,
    CIPHERREQUEST: 59,
    DERIVEBITSREQUEST: 60,
    HASHREQUEST: 61,
    RANDOMBYTESREQUEST: 62,
    RANDOMPRIMEREQUEST: 63,
    SCRYPTREQUEST: 64,
    SIGNREQUEST: 65,
    TLSWRAP: 66,
    VERIFYREQUEST: 67,
  };

  // @types/node still declares the pre-v26 key set, so compare through an untyped view.
  const providers: Record<string, number> = asyncWrapProviders;

  test("has node's provider table, in node's order", () => {
    expect({ ...providers }).toEqual(nodeProviders);
    expect(Object.keys(providers)).toEqual(Object.keys(nodeProviders));
  });

  test("is a frozen null-prototype object", () => {
    expect(Object.getPrototypeOf(providers)).toBeNull();
    expect(Object.isFrozen(providers)).toBe(true);
    expect("constructor" in providers).toBe(false);
    expect(Object.getOwnPropertyDescriptor(providers, "NONE")).toEqual({
      value: 0,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  });

  test("rejects modification", () => {
    expect(() => {
      providers.NONE = 1;
    }).toThrow(TypeError);
    expect(() => {
      providers.BUNWRAP = 68;
    }).toThrow(TypeError);
    expect(() => {
      delete providers.NONE;
    }).toThrow(TypeError);
    expect({ ...providers }).toEqual(nodeProviders);
  });
});
