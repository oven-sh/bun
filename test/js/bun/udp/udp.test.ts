import { bind, spawnSync } from "bun";
import { describe, test, expect, mock, afterAll, afterEach } from "bun:test";
import { randomPort, hasIP } from "harness";

describe("bind()", () => {
  test("can create a socket", () => {
    const socket = bind({});
    expect(socket).toBeInstanceOf(Object);
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.port).toBe(socket.port); // test that property is cached
    expect(socket.hostname).toBeString();
    expect(socket.hostname).toBe(socket.hostname); // test that property is cached
    expect(socket.address).toEqual({
      address: socket.hostname,
      family: socket.hostname === "::" ? "IPv6" : "IPv4",
      port: socket.port,
    });
    expect(socket.address).toBe(socket.address); // test that property is cached
    expect(socket.binaryType).toBe("nodebuffer");
    expect(socket.binaryType).toBe(socket.binaryType); // test that property is cached
    expect(socket.ref).toBeFunction();
    expect(socket.unref).toBeFunction();
    expect(socket.send).toBeFunction();
    expect(socket.close).toBeFunction();
    socket.close();
  });

  test("can create a socket with given port", () => {
    const port = randomPort();
    const socket = bind({ port });
    expect(socket.port).toBe(port);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  test("can create a socket with a random port", () => {
    const socket = bind({ port: 0 });
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  describe.each([
    { hostname: "localhost" },
    { hostname: "127.0.0.1", skip: !hasIP("IPv4") },
    { hostname: "::1", skip: !hasIP("IPv6") },
  ])("can create a socket with given hostname", ({ hostname, skip }) => {
    test.skipIf(skip)(hostname, () => {
      const socket = bind({ hostname });
      expect(socket.hostname).toBe(hostname);
      expect(socket.port).toBeInteger();
      expect(socket.port).toBeWithin(1, 65535 + 1);
      expect(socket.address).toMatchObject({ port: socket.port });
      socket.close();
    });
  });

  describe.each([
    {
      binaryType: undefined,
      type: Buffer,
    },
    {
      binaryType: "nodebuffer",
      type: Buffer,
    },
    {
      binaryType: "arraybuffer",
      type: ArrayBuffer,
    },
    {
      binaryType: "uint8array",
      type: Uint8Array,
    },
  ])("can receive data from a socket", ({ binaryType, type }) => {
    const onData = mock((socket, data, port, address) => {
      expect(socket).toBeInstanceOf(Object);
      expect(socket.binaryType).toBe(binaryType || "nodebuffer");
      expect(data).toBeInstanceOf(type);
      expect(port).toBeInteger();
      expect(port).toBeWithin(1, 65535 + 1);
      expect(port).not.toBe(socket.port);
      expect(address).toBeString();
      expect(address).not.toBeEmpty();
    });
    const socket = bind({
      binaryType: binaryType as any,
      socket: {
        data: onData,
      },
    });
    test.each([
      {
        label: "string (ascii)",
        data: "ascii",
        bytes: [0x61, 0x73, 0x63, 0x69, 0x69],
      },
      {
        label: "string (latin1)",
        data: "latin1-©",
        bytes: [0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x2d, 0xc2, 0xa9],
      },
      {
        label: "string (utf-8)",
        data: "utf8-😶",
        bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x98, 0xb6],
      },
      {
        label: "string (empty)",
        data: "",
        bytes: [],
      },
      {
        label: "Uint8Array (utf-8)",
        data: new TextEncoder().encode("utf8-🙂"),
        bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x82],
      },
      {
        label: "Uint8Array (empty)",
        data: new Uint8Array(),
        bytes: [],
      },
      {
        label: "ArrayBuffer (utf-8)",
        data: new TextEncoder().encode("utf8-🙃").buffer,
        bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x83],
      },
      {
        label: "ArrayBuffer (empty)",
        data: new ArrayBuffer(0),
        bytes: [],
      },
      {
        label: "Buffer (utf-8)",
        data: Buffer.from("utf8-🤩"),
        bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9],
      },
      {
        label: "Buffer (empty)",
        data: Buffer.from([]),
        bytes: [],
      },
    ])("$label", ({ data, bytes }) => {
      send(socket.port, socket.hostname, data);
      expect(onData.mock.calls).toHaveLength(1);
      expect(onData.mock.calls[0]).toHaveLength(4);
      expect(onData.mock.calls[0][0]).toStrictEqual(socket);
      expect(onData.mock.calls[0][1]).toBeInstanceOf(type);
      expect(onData.mock.calls[0][1]).toHaveLength(bytes.length);
      expect(Buffer.from(onData.mock.calls[0][1])).toStrictEqual(Buffer.from(bytes));
      expect(onData.mock.calls[0][2]).toBeInteger();
      expect(onData.mock.calls[0][2]).toBeWithin(1, 65535 + 1);
      expect(onData.mock.calls[0][2]).not.toBe(socket.port);
      expect(onData.mock.calls[0][3]).toBeString();
    });
    afterEach(() => {
      onData.mockClear();
    });
    afterAll(() => {
      socket.close();
    });
  });

  const sendCases = [
    {
      label: "string (ascii)",
      data: "ascii",
      bytes: [0x61, 0x73, 0x63, 0x69, 0x69],
    },
    {
      label: "string (latin1)",
      data: "latin1-©",
      bytes: [0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x2d, 0xc2, 0xa9],
    },
    {
      label: "string (utf-8)",
      data: "utf8-😶",
      bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x98, 0xb6],
    },
    {
      label: "string (empty)",
      data: "",
      bytes: [],
    },
    {
      label: "Uint8Array (utf-8)",
      data: new TextEncoder().encode("utf8-🙂"),
      bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x82],
    },
    {
      label: "Uint8Array (empty)",
      data: new Uint8Array(),
      bytes: [],
    },
    {
      label: "ArrayBuffer (utf-8)",
      data: new TextEncoder().encode("utf8-🙃").buffer,
      bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x83],
    },
    {
      label: "ArrayBuffer (empty)",
      data: new ArrayBuffer(0),
      bytes: [],
    },
    {
      label: "Buffer (utf-8)",
      data: Buffer.from("utf8-🤩"),
      bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9],
    },
    {
      label: "Buffer (empty)",
      data: Buffer.from([]),
      bytes: [],
    },
  ];

  describe.each(sendCases)("can send data to a socket", ({ label, data, bytes }) => {
    test(label, (done) => {
      const client = bind({});
      const server = bind({
        socket: {
          data(socket, data, port, address) {
            expect(socket).toBeInstanceOf(Object);
            expect(socket.binaryType).toBe("nodebuffer");
            expect(data).toBeInstanceOf(Buffer);
            expect(data).toHaveLength(bytes.length);
            expect(data).toStrictEqual(Buffer.from(bytes));
            expect(port).toBeInteger();
            expect(port).toBeWithin(1, 65535 + 1);
            expect(port).not.toBe(socket.port);
            expect(address).toBeString();
            socket.close();
            done();
          },
        },
      });
      client.send(data, server.port, "127.0.0.1");
    });
  });
});


function send(port: number, address: string, data: string | BufferSource): void {
  const base64 = typeof data === "string" ? "" : "1";
  const message = typeof data === "string" ? data : Buffer.from(data as any).toString("base64");
  const { exitCode, stderr } = spawnSync({
    cmd: ["node", new URL("./send.cjs", import.meta.url).pathname, `${port}`, address, message, base64],
    stderr: "pipe",
    stdout: "inherit",
  });
  if (exitCode !== 0) {
    const reason = Buffer.from(stderr).toString();
    throw new Error(reason);
  }
}

// function send(port: number, address: string, data: string | BufferSource): void {
//   const client = bind({});
//   client.send(data, port, address);
//   // client.close();
// }
