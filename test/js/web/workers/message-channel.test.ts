test("simple usage", done => {
  const channel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = (e: MessageEvent) => {
    expect(e.data).toEqual("hello");
    done();
  };

  port1.postMessage("hello");
});

test("transfer message port", done => {
  const channel = new MessageChannel();
  const anotherChannel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = (e: MessageEvent) => {
    expect(e.data).toEqual("hello");
    expect(e.ports).toHaveLength(1);
    expect(e.ports[0]).toBeInstanceOf(MessagePort);
    done();
  };

  port1.postMessage("hello", [anotherChannel.port2]);
});

test("transfer array buffer", done => {
  const channel = new MessageChannel();
  const port1 = channel.port1;
  const port2 = channel.port2;

  port2.onmessage = (e: MessageEvent) => {
    expect(e.data).toBeInstanceOf(ArrayBuffer);
    expect(e.data.byteLength).toEqual(8);
    done();
  };

  const buffer = new ArrayBuffer(8);

  port1.postMessage(buffer, [buffer]);
});

test("non-transferable", () => {
  const channel = new MessageChannel();
  channel.port2.onmessage = () => {
    expect().fail("should not be reached");
  };
  expect(() => {
    channel.port1.postMessage("hello", [channel.port1]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("hello", [channel.port2]);
  }).toThrow();
});

test("transfer message ports and post messages", done => {
  const c1 = new MessageChannel();
  const c2 = new MessageChannel();

  c1.port1.onmessage = (e: MessageEvent) => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 2");
    port.onmessage = (e: MessageEvent) => {
      expect(e.data).toEqual("hello from channel 1 port 2");
      done();
    };
    port.postMessage("hello from channel 1 port 1", [c1.port1]);
  };

  c1.port2.onmessage = (e: MessageEvent) => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 2 port 1");
    port.postMessage("hello from channel 1 port 2");
  };

  c2.port1.onmessage = (e: MessageEvent) => {
    const port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 1");
    port.postMessage("hello from channel 2 port 1", [c2.port1]);
  };

  c2.port2.onmessage = () => {
    expect().fail("onmessage defined on c1.port1 should be called instead");
  };

  c1.port2.postMessage("hello from channel 1 port 2", [c2.port2]);
});

test("message channel created on main thread", done => {
  const worker = new Worker(new URL("receive-port-worker.js", import.meta.url).href);
  worker.onerror = e => {
    expect().fail();
    done();
  };
  const channel = new MessageChannel();
  channel.port1.onmessage = (e: MessageEvent) => {
    if (e.data === "done!") return done();
    expect(e.data).toEqual("received port!");
    channel.port1.postMessage("more message!");
  };
  worker.postMessage(channel.port2, { transfer: [channel.port2] });
});

test("message channel created on other thread", done => {
  const worker = new Worker(new URL("create-port-worker.js", import.meta.url).href);
  worker.onerror = () => {
    expect().fail();
    done();
  };
  worker.onmessage = e => {
    expect(e.data).toBeInstanceOf(MessagePort);
    const port = e.data;
    port.onmessage = (e: MessageEvent) => {
      expect(e.data).toEqual("done!");
      done();
    };
    port.postMessage("hello from main thread");
  };
});

test("many message channels", done => {
  const channel = new MessageChannel();
  const channel2 = new MessageChannel();
  const channel3 = new MessageChannel();
  const channel4 = new MessageChannel();

  channel.port1.postMessage("noport");
  channel.port1.postMessage("zero ports", []);
  channel.port1.postMessage("two ports", [channel2.port1, channel2.port2]);

  // Now test failure cases
  expect(() => {
    channel.port1.postMessage("same port", [channel.port1]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("entangled port", [channel.port2]);
  }).toThrow();
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("null port", [channel3.port1, null, channel3.port2]);
  }).toThrow();
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notAPort", [channel3.port1, {}, channel3.port2]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("duplicate port", [channel3.port1, channel3.port1]);
  }).toThrow();

  // Should be OK to send channel3.port1 (should not have been disentangled by the previous failed calls).
  expect(() => {
    channel.port1.postMessage("entangled ports", [channel3.port1, channel3.port2]);
  }).not.toThrow();

  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notAnArray", "foo");
  }).toThrow();
  expect(() => {
    // @ts-ignore
    channel.port1.postMessage("notASequence", [{ length: 3 }]);
  }).toThrow();

  // Should not crash (we should figure out that the array contains undefined entries).
  const largePortArray: MessagePort[] = [];
  largePortArray[1234567890] = channel4.port1;
  expect(() => {
    channel.port1.postMessage("largeSequence", largePortArray);
  }).toThrow();

  channel.port1.postMessage("done");

  function testTransfers(done: any) {
    const channel0 = new MessageChannel();

    const c1 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port", port: c1.port1 }, [c1.port1]);
    const c2 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port-twice", port0: c2.port1, port1: c2.port1 }, [c2.port1]);
    const c3 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-two-ports", port0: c3.port1, port1: c3.port2 }, [c3.port1, c3.port2]);
    const c4 = new MessageChannel();

    // Sending host objects should throw
    expect(() => {
      channel0.port1.postMessage({ id: "host-object", hostObject: c3, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Function object should throw
    expect(() => {
      const f1 = function () {};
      channel0.port1.postMessage({ id: "function-object", function: f1, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Error object should not throw
    expect(() => {
      const err = new Error();
      channel0.port1.postMessage({ id: "error-object", error: err, port: c4.port1 }, [c4.port1]);
    }).not.toThrow();

    c4.port1.postMessage("Should succeed");
    channel0.port1.postMessage({ id: "done" });

    channel0.port2.onmessage = function (event: MessageEvent) {
      if (event.data.id == "send-port") {
        expect(event.ports.length).toBeGreaterThan(0);
        expect(event.ports[0]).toBe(event.data.port);
      } else if (event.data.id == "error-object") {
        expect(event.data.error).toBeInstanceOf(Error);
      } else if (event.data.id == "send-port-twice") {
        expect(event.ports).toBeDefined();
        expect(event.ports.length).toBe(1);
        expect(event.ports[0]).toBe(event.data.port0);
        expect(event.ports[0]).toBe(event.data.port1);
      } else if (event.data.id == "send-two-ports") {
        expect(event.ports).toBeDefined();
        expect(event.ports.length).toBe(2);
        expect(event.ports[0]).toBe(event.data.port0);
        expect(event.ports[1]).toBe(event.data.port1);
      } else if (event.data.id == "done") {
        done();
      } else {
        expect().fail("branch should not be reached");
      }
    };
  }

  channel.port2.onmessage = function (event: MessageEvent) {
    if (event.data == "noport" || event.data == "zero ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(0);
    } else if (event.data == "two ports" || event.data == "entangled ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(2);
    } else if (event.data == "done") {
      testTransfers(done);
    } else {
      expect().fail("branch should not be reached");
    }
  };
});

test("gc", () => {
  for (let i = 0; i < 1000; i++) {
    const messageChannel = new MessageChannel();
    messageChannel.port1;
    messageChannel.port2;
  }
});

test("cloneable and transferable equals", async () => {
  const assert = require("assert");
  const mc = new MessageChannel();
  const original = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const buf = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const ab = buf.buffer.transfer();
  expect(ab).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(ab)).toEqual(original);
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(data)).toEqual(original);
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(ab);
  await promise;
});

test("cloneable and non-transferable equals (BunFile)", async () => {
  const mc = new MessageChannel();
  const file = Bun.file(import.meta.filename);
  expect(file).toBeInstanceOf(Blob); // Bun.BunFile isnt exposed to JS
  expect(file.name).toEqual(import.meta.filename);
  expect(file.type).toEqual("text/javascript;charset=utf-8");
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf(file.__proto__.constructor);
      expect(data.name).toEqual(import.meta.filename);
      expect(data.type).toEqual("text/javascript;charset=utf-8");
      // expect(data).not.toBeEmptyObject();
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(file);
  await promise;
});

test("cloneable and non-transferable equals (net.BlockList)", async () => {
  const net = require("node:net");
  const mc = new MessageChannel();
  const blocklist = new net.BlockList();
  blocklist.addAddress("123.123.123.123");
  const { promise, resolve, reject } = Promise.withResolvers();
  mc.port1.onmessage = ({ data }) => {
    try {
      expect(data).toBeInstanceOf(net.BlockList);
      expect(data.check("123.123.123.123")).toBeTrue();
      expect(!data.check("123.123.123.124")).toBeTrue();
      data.addAddress("123.123.123.124");
      expect(blocklist.check("123.123.123.124")).toBeTrue();
      expect(data.check("123.123.123.124")).toBeTrue();
      mc.port1.close();
      resolve();
    } catch (e) {
      reject(e);
    }
  };
  mc.port2.postMessage(blocklist);
  await promise;
});
