/**
 * @see https://nodejs.org/api/net.html#class-netsocketaddress
 */
import { SocketAddress, SocketAddressInitOptions } from "node:net";

let v4: SocketAddress;
let v6: SocketAddress;

beforeEach(() => {
  v4 = new SocketAddress({ family: "ipv4" });
  v6 = new SocketAddress({ family: "ipv6" });
});

describe("SocketAddress constructor", () => {
  it("is named SocketAddress", () => {
    expect(SocketAddress.name).toBe("SocketAddress");
  });

  it("is newable", () => {
    // @ts-expect-error -- types are wrong. default is kEmptyObject.
    expect(new SocketAddress()).toBeInstanceOf(SocketAddress);
  });

  // FIXME: setting `call: false` in codegen has no effect, but should make the
  // constructor non-callable.
  it.skip("is not callable", () => {
    // @ts-expect-error -- types are wrong.
    expect(() => SocketAddress()).toThrow(TypeError);
  });

  describe.each([
    new SocketAddress(),
    new SocketAddress(undefined),
    new SocketAddress({}),
    new SocketAddress({ family: undefined }),
    new SocketAddress({ family: "ipv4" }),
  ])("new SocketAddress()", address => {
    it("creates an ipv4 address", () => {
      expect(address.family).toBe("ipv4");
    });

    it("address is 127.0.0.1", () => {
      expect(address.address).toBe("127.0.0.1");
    });

    it("port is 0", () => {
      expect(address.port).toBe(0);
    });

    it("flowlabel is 0", () => {
      expect(address.flowlabel).toBe(0);
    });
  }); // </new SocketAddress()>

  describe("new SocketAddress({ family: 'ipv6' })", () => {
    it("creates a new ipv6 any address", () => {
      expect(v6).toMatchObject({
        address: "::",
        port: 0,
        family: "ipv6",
        flowlabel: 0,
      });
    });
  }); // </new SocketAddress({ family: 'ipv6' })>

  it.each([
    [
      { family: "ipv4", address: "1.2.3.4", port: 1234, flowlabel: 9 },
      { address: "1.2.3.4", port: 1234, family: "ipv4", flowlabel: 0 },
    ],
    // family gets lowercased
    [{ family: "IPv4" }, { address: "127.0.0.1", family: "ipv4", port: 0 }],
    [{ family: "IPV6" }, { address: "::", family: "ipv6", port: 0 }],
  ] as [SocketAddressInitOptions, Partial<SocketAddress>][])(
    "new SocketAddress(%o) matches %o",
    (options, expected) => {
      const address = new SocketAddress(options);
      expect(address).toMatchObject(expected);
    },
  );

  // ===========================================================================
  // ============================ INVALID ARGUMENTS ============================
  // ===========================================================================

  it.each([Symbol.for("ipv4"), function ipv4() {}, { family: "ipv4" }, "ipv1", "ip"])(
    "given an invalid family, throws ERR_INVALID_ARG_VALUE",
    (family: any) => {
      expect(() => new SocketAddress({ family })).toThrowWithCode(Error, "ERR_INVALID_ARG_VALUE");
    },
  );

  // ===========================================================================
  // ============================= LEAK DETECTION ==============================
  // ===========================================================================

  it("does not leak memory", () => {
    const growthFactor = 3.0; // allowed growth factor for memory usage
    const warmup = 1_000; // # of warmup iterations
    const iters = 100_000; // # of iterations
    const debug = false;

    // we want to hit both cached and uncached code paths
    const options = [
      undefined,
      { family: "ipv6" },
      { family: "ipv4", address: "1.2.3.4", port: 3000 },
      { family: "ipv6", address: "::3", port: 9 },
    ] as SocketAddressInitOptions[];

    // warmup
    var sa;
    for (let i = 0; i < warmup; i++) {
      sa = new SocketAddress(options[i % options.length]);
    }
    sa = undefined;
    Bun.gc(true);

    const before = process.memoryUsage();
    if (debug) console.log("before", before);

    // actual test
    for (let i = 0; i < iters; i++) {
      sa = new SocketAddress(options[i % 2]);
    }
    sa = undefined;
    Bun.gc(true);

    const after = process.memoryUsage();
    if (debug) console.log("after", after);

    expect(after.rss).toBeLessThanOrEqual(before.rss * growthFactor);
  });
}); // </SocketAddress constructor>

describe("SocketAddress.isSocketAddress", () => {
  it("is a function that takes 1 argument", () => {
    expect(SocketAddress).toHaveProperty("isSocketAddress");
    expect(SocketAddress.isSocketAddress).toBeInstanceOf(Function);
    expect(SocketAddress.isSocketAddress).toHaveLength(1);
  });

  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress, "isSocketAddress");
    expect(desc).toEqual({
      value: expect.any(Function),
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  it("returns true for a SocketAddress instance", () => {
    expect(SocketAddress.isSocketAddress(v4)).toBeTrue();
    expect(SocketAddress.isSocketAddress(v6)).toBeTrue();
  });

  it("returns false for POJOs that look like a SocketAddress", () => {
    const notASocketAddress = {
      address: "127.0.0.1",
      port: 0,
      family: "ipv4",
      flowlabel: 0,
    };
    expect(SocketAddress.isSocketAddress(notASocketAddress)).toBeFalse();
  });

  it("returns false for faked SocketAddresses", () => {
    const fake = Object.create(SocketAddress.prototype);
    for (const key of Object.keys(v4)) {
      fake[key] = v4[key];
    }
    expect(fake instanceof SocketAddress).toBeTrue();
    expect(SocketAddress.isSocketAddress(fake)).toBeFalse();
  });

  it("returns false for subclasses", () => {
    class NotASocketAddress extends SocketAddress {}
    expect(SocketAddress.isSocketAddress(new NotASocketAddress())).toBeFalse();
  });
}); // </SocketAddress.isSocketAddress>

describe("SocketAddress.parse", () => {
  it("is a function that takes 1 argument", () => {
    expect(SocketAddress).toHaveProperty("parse");
    expect(SocketAddress.parse).toBeInstanceOf(Function);
    expect(SocketAddress.parse).toHaveLength(1);
  });

  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress, "parse");
    expect(desc).toEqual({
      value: expect.any(Function),
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  it.each([
    ["1.2.3.4", { address: "1.2.3.4", port: 0, family: "ipv4" }],
    ["192.168.257:1", { address: "192.168.1.1", port: 1, family: "ipv4" }],
    ["256", { address: "0.0.1.0", port: 0, family: "ipv4" }],
    ["999999999:12", { address: "59.154.201.255", port: 12, family: "ipv4" }],
    ["0xffffffff", { address: "255.255.255.255", port: 0, family: "ipv4" }],
    ["0x.0x.0", { address: "0.0.0.0", port: 0, family: "ipv4" }],
    ["[1:0::]", { address: "1::", port: 0, family: "ipv6" }],
    ["[1::8]:123", { address: "1::8", port: 123, family: "ipv6" }],
  ])("(%s) == %o", (input, expected) => {
    const sa = SocketAddress.parse(input);
    expect(sa).toBeDefined();
    expect(sa.toJSON()).toMatchObject(expected);
  });

  it.each([
    "",
    "invalid",
    "1.2.3.4.5.6",
    "0.0.0.9999",
    "1.2.3.4:-1",
    "1.2.3.4:null",
    "1.2.3.4:65536",
    "[1:0:::::::]", // line break
  ])("parse('%s') == undefined", invalidInput => {
    expect(SocketAddress.parse(invalidInput)).toBeUndefined();
  });
}); // </SocketAddress.parse>

describe("SocketAddress.prototype.address", () => {
  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress.prototype, "address");
    expect(desc).toEqual({
      get: expect.any(Function),
      set: undefined,
      enumerable: false,
      configurable: true,
    });
  });

  it("is read-only", () => {
    const addr = new SocketAddress();
    // @ts-expect-error -- ofc it's read-only
    expect(() => (addr.address = "1.2.3.4")).toThrow();
  });
}); // </SocketAddress.prototype.address>

describe("SocketAddress.prototype.port", () => {
  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress.prototype, "port");
    expect(desc).toEqual({
      get: expect.any(Function),
      set: undefined,
      enumerable: false,
      configurable: true,
    });
  });
}); // </SocketAddress.prototype.port>

describe("SocketAddress.prototype.family", () => {
  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress.prototype, "family");
    expect(desc).toEqual({
      get: expect.any(Function),
      set: undefined,
      enumerable: false,
      configurable: true,
    });
  });
}); // </SocketAddress.prototype.family>

describe("SocketAddress.prototype.flowlabel", () => {
  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress.prototype, "flowlabel");
    expect(desc).toEqual({
      get: expect.any(Function),
      set: undefined,
      enumerable: false,
      configurable: true,
    });
  });
}); // </SocketAddress.prototype.flowlabel>

describe("SocketAddress.prototype.toJSON", () => {
  it("is a function that takes 0 arguments", () => {
    expect(SocketAddress.prototype).toHaveProperty("toJSON");
    expect(SocketAddress.prototype.toJSON).toBeInstanceOf(Function);
    expect(SocketAddress.prototype.toJSON).toHaveLength(0);
  });

  it("has the correct property descriptor", () => {
    const desc = Object.getOwnPropertyDescriptor(SocketAddress.prototype, "toJSON");
    expect(desc).toEqual({
      value: expect.any(Function),
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  it("returns an object with address, port, family, and flowlabel", () => {
    expect(v4.toJSON()).toEqual({
      address: "127.0.0.1",
      port: 0,
      family: "ipv4",
      flowlabel: 0,
    });
    expect(v6.toJSON()).toEqual({
      address: "::",
      port: 0,
      family: "ipv6",
      flowlabel: 0,
    });
  });

  describe("When called on a default SocketAddress", () => {
    let address: Record<string, any>;

    beforeEach(() => {
      address = v4.toJSON();
    });

    it("SocketAddress.isSocketAddress() returns false", () => {
      expect(SocketAddress.isSocketAddress(address)).toBeFalse();
    });

    it("does not have SocketAddress as its prototype", () => {
      expect(Object.getPrototypeOf(address)).not.toBe(SocketAddress.prototype);
      expect(address instanceof SocketAddress).toBeFalse();
    });
  }); // </When called on a default SocketAddress>
}); // </SocketAddress.prototype.toJSON>
