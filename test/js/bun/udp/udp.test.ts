import { udpSocket } from "bun";
import { describe, test, expect, it } from "bun:test";
import { randomPort, hasIP } from "harness";
import { createSocket } from "dgram";

const nodeDataTypes = [
  {
    binaryType: "buffer",
    type: Buffer,
  },
  {
    binaryType: "uint8array",
    type: Uint8Array,
  },
]

const dataTypes = [
  ...nodeDataTypes,
  {
    binaryType: undefined,
    type: Buffer,
  },
  {
    binaryType: "arraybuffer",
    type: ArrayBuffer,
  },
];

const nodeDataCases = [
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
    label: "Buffer (utf-8)",
    data: Buffer.from("utf8-🤩"),
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9],
  },
  {
    label: "Buffer (empty)",
    data: Buffer.from([]),
    bytes: [],
  },
]

const dataCases = [
  ...nodeDataCases,
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
];


describe("udpSocket()", () => {
  test("can create a socket", async () => {
    const socket = await udpSocket({});
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

  test("can create a socket with given port", async () => {
    const port = randomPort();
    const socket = await udpSocket({ port });
    expect(socket.port).toBe(port);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  test("can create a socket with a random port", async () => {
    const socket = await udpSocket({ port: 0 });
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
    test.skipIf(skip)(hostname, async () => {
      const socket = await udpSocket({ hostname });
      expect(socket.hostname).toBe(hostname);
      expect(socket.port).toBeInteger();
      expect(socket.port).toBeWithin(1, 65535 + 1);
      expect(socket.address).toMatchObject({ port: socket.port });
      socket.close();
    });
  });

  const validateRecv = (socket, data, port, address, binaryType, bytes) => {
    expect(socket).toBeInstanceOf(Object);
    expect(socket.binaryType).toBe(binaryType || "buffer");
    expect(data).toHaveLength(bytes.length);
    if (data instanceof ArrayBuffer) {
      expect(new Uint8Array(data)).toStrictEqual(new Uint8Array(bytes));
    } else {
      expect(Buffer.from(data)).toStrictEqual(Buffer.from(bytes));
    }
    expect(port).toBeInteger();
    expect(port).toBeWithin(1, 65535 + 1);
    expect(port).not.toBe(socket.port);
    expect(address).toBeString();
    expect(address).not.toBeEmpty();
  }

  const validateSend = (res) => {
    expect(res).toBeBoolean();
  }

  const validateSendMany = (res, count) => {
    expect(res).toBeNumber();
    expect(res).toBeGreaterThanOrEqual(0);
    expect(res).toBeLessThanOrEqual(count);
  }


  for (const { binaryType, type } of dataTypes) {
    for (const { label, data, bytes } of dataCases) {
      test(`send ${label} (${binaryType || "undefined"})`, async (done) => {
        const client = await udpSocket({});
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);
              
              server.close();
              client.close();
              done();
            },
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data, server.port, '127.0.0.1'));
            setTimeout(sendRec, 100);
          }
        }
        sendRec();
      });

      test(`send connected ${label} (${binaryType || "undefined"})`, async (done) => {
        let client;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);
              
              server.close();
              client.close();
              done();
            },
          },
        });
        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: server.hostname,
          }
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data));
            setTimeout(sendRec, 100);
          }
        }
        sendRec();
      });

      test(`sendMany ${label} (${binaryType || "undefined"})`, async (done) => {
        const client = await udpSocket({});
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        const payload = Array(100).fill([data, server.port, '127.0.0.1']).flat();

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 100);
          }
        }
        sendRec();
      });
      
      test(`sendMany connected ${label} (${binaryType || "undefined"})`, async (done) => {
        // const client = await udpSocket({});
        let client;
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: server.hostname,
          }
        });

        const payload = Array(100).fill(data);

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 100);
          }
        }
        sendRec();
      });
    }
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

  test("IPv4 address", (done) => {
    const socket = createSocket('udp4');

    socket.on('listening', () => {
      const address = socket.address();

      expect(address.address).toBe('127.0.0.1');
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe('IPv4');
      socket.close(done);
    });

    socket.on('error', (err) => {
      socket.close(done);
      expect(err).toBeNull();
    });

    socket.bind(0, '127.0.0.1');
  });

  test.skipIf(!hasIP("IPv6"))("IPv6 address", (done) => {
    const socket = createSocket('udp6');
    const localhost = '::1';

    socket.on('listening', () => {
      const address = socket.address();

      expect(address.address).toBe(localhost);
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe('IPv6');
      socket.close(done);
    });

    socket.on('error', (err) => {
      socket.close(done);
      expect(err).toBeNull();
    });

    socket.bind(0, localhost);
  });

  const validateRecv = (server, data, rinfo, bytes) => {
    expect(data).toHaveLength(bytes.length);
    expect(data).toStrictEqual(Buffer.from(bytes));
    expect(rinfo.port).toBeInteger();
    expect(rinfo.port).toBeWithin(1, 65535 + 1);
    expect(rinfo.address).toBeString();
    expect(rinfo.address).not.toBeEmpty();
    expect(rinfo.port).not.toBe(server.address().port);
  }

  for (const { label, data, bytes } of nodeDataCases) {
    test(`send ${label}`, (done) => {
      const client = createSocket('udp4');
      const closed = { closed: false };
      client.on('close', () => { closed.closed = true });
      const server = createSocket('udp4');
      server.on('message', (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);
        
        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, server.address().port, '127.0.0.1', () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on('listening', () => {
        sendRec();
      });
      server.bind();
    });


    test(`send connected ${label}`, (done) => {
      const client = createSocket('udp4');
      const closed = { closed: false };
      client.on('close', () => { closed.closed = true });
      const server = createSocket('udp4');
      server.on('message', (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);
        
        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on('listening', () => {
        const addr = server.address();
        client.connect(addr.port, addr.address, () => {
          sendRec();
        })
      });
      server.bind();
    });

    test(`send batch ${label}`, (done) => {
      const client = createSocket('udp4');
      const closed = { closed: false };
      client.on('close', () => { closed.closed = true });
      const server = createSocket('udp4');
      let count = 0;
      server.on('message', (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);

        count += 1;
        if (count === 100) {
          server.close();
          client.close();
          done();
        }
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(Array(100).fill(data), server.address().port, '127.0.0.1', () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on('listening', () => {
        sendRec();
      });
      server.bind();
    });

    test(`send batch connected ${label}`, (done) => {
      const client = createSocket('udp4');
      const closed = { closed: false };
      client.on('close', () => { closed.closed = true });
      const server = createSocket('udp4');
      let count = 0;
      server.on('message', (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);
        
        count += 1;
        if (count === 100) {
          server.close();
          client.close();
          done();
        }
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(Array(100).fill(data), () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on('listening', () => {
        const addr = server.address();
        client.connect(addr.port, addr.address, () => {
          sendRec();
        })
      });
      server.bind();
    });

  }

});
