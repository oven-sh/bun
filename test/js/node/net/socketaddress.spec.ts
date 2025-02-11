/**
 * @see https://nodejs.org/api/net.html#class-netsocketaddress
 */
import { SocketAddress } from "node:net";

describe("SocketAddress", () => {
  it("is named SocketAddress", () => {
    expect(SocketAddress.name).toBe("SocketAddress");
  });

  it("is newable", () => {
    // @ts-expect-error -- types are wrong. default is kEmptyObject.
    expect(new SocketAddress()).toBeInstanceOf(SocketAddress);
  });

  it("is not callable", () => {
    // @ts-expect-error -- types are wrong.
    expect(() => SocketAddress()).toThrow(TypeError);
  });

  describe.each([new SocketAddress(), new SocketAddress(undefined), new SocketAddress({})])(
    "new SocketAddress()",
    address => {
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
    },
  ); // </new SocketAddress()>

  describe("new SocketAddress({ family: 'ipv6' })", () => {
    let address: SocketAddress;
    beforeAll(() => {
      address = new SocketAddress({ family: "ipv6" });
    });
    it("creates a new ipv6 any address", () => {
      expect(address).toMatchObject({
        address: "::",
        port: 0,
        family: "ipv6",
        flowlabel: 0,
      });
    });
  }); // </new SocketAddress({ family: 'ipv6' })>
}); // </SocketAddress>

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
    expect(SocketAddress.parse(input)).toMatchObject(expected);
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
  ])("(%s) == undefined", invalidInput => {
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

  describe("When called on a default SocketAddress", () => {
    let address: Record<string, any>;
    beforeEach(() => {
      address = new SocketAddress().toJSON();
    });

    it("returns an object with an address, port, family, and flowlabel", () => {
      expect(address).toEqual({
        address: "127.0.0.1",
        port: 0,
        family: "ipv4",
        flowlabel: 0,
      });
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
