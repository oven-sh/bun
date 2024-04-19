import { bindUDP } from "bun";
import { describe, test, expect } from "bun:test";
import { randomPort, hasIP } from "harness";
import { createSocket } from "dgram";

describe("bind()", () => {
  test("can create a socket", () => {
    const socket = bindUDP({});
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
    expect(socket.binaryType).toBe("buffer");
    expect(socket.binaryType).toBe(socket.binaryType); // test that property is cached
    expect(socket.ref).toBeFunction();
    expect(socket.unref).toBeFunction();
    expect(socket.send).toBeFunction();
    expect(socket.close).toBeFunction();
    socket.close();
  });

  test("can create a socket with given port", () => {
    const port = randomPort();
    const socket = bindUDP({ port });
    expect(socket.port).toBe(port);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  test("can create a socket with a random port", () => {
    const socket = bindUDP({ port: 0 });
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
      const socket = bindUDP({ hostname });
      expect(socket.hostname).toBe(hostname);
      expect(socket.port).toBeInteger();
      expect(socket.port).toBeWithin(1, 65535 + 1);
      expect(socket.address).toMatchObject({ port: socket.port });
      socket.close();
    });
  });


  const dataTypes = [
    {
      binaryType: undefined,
      type: Buffer,
    },
    {
      binaryType: "buffer",
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
  ];

  const recvCases = [
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

  for (const { binaryType, type } of dataTypes) {
    for (const { label, data, bytes } of recvCases) {
      test(`${label} (${binaryType || "undefined"})`, (done) => {
        const client = bindUDP({});
        const server = bindUDP({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              expect(socket).toBeInstanceOf(Object);
              expect(socket.binaryType).toBe(binaryType || "buffer");
              expect(data).toBeInstanceOf(type);
              expect(port).toBeInteger();
              expect(port).toBeWithin(1, 65535 + 1);
              expect(port).not.toBe(socket.port);
              expect(address).toBeString();
              expect(address).not.toBeEmpty();
              server.close();
              client.close();
              done();
            },
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            client.send(data, server.port, '127.0.0.1');
            setTimeout(sendRec, 100);
          }
        }
        sendRec();
      });
    }
  }

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

  for (const { label, data, bytes } of sendCases) {
    test(label, (done) => {
      const client = bindUDP({});
      const server = bindUDP({
        socket: {
          data(socket, data, port, address) {
            expect(socket).toBeInstanceOf(Object);
            expect(socket.binaryType).toBe("buffer");
            expect(data).toBeInstanceOf(Buffer);
            expect(data).toHaveLength(bytes.length);
            expect(data).toStrictEqual(Buffer.from(bytes));
            expect(port).toBeInteger();
            expect(port).toBeWithin(1, 65535 + 1);
            expect(port).not.toBe(socket.port);
            expect(address).toBeString();
            client.close();
            server.close();
            done();
          },
        },
      });
      // handle unreliable transmission in UDP
      function sendRec() {
        if (!client.closed) {
          client.send(data, server.port, "127.0.0.1");
          setTimeout(sendRec, 100);
        }
      }
      sendRec();
    });
  }
});

describe("createSocket()", () => {
  test("connect", (done) => {
    const PORT = 12345;
    const client = createSocket("udp4");
    client.on('close', done);

    client.connect(PORT, () => {
      const remoteAddr = client.remoteAddress();
      expect(remoteAddr.port).toBe(PORT);
      expect(() => client.connect(PORT)).toThrow();
    
      client.disconnect();
      expect(() => client.disconnect()).toThrow();
    
      expect(() => client.remoteAddress()).toThrow();
    
      client.once('connect', () => client.close());
      client.connect(PORT);
    });
  });
});

/*
function send(data: string | BufferSource, port: number, address: string): void {
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
*/
