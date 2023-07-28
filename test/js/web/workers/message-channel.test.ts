test("simple usage", done => {
  var channel = new MessageChannel();
  var port1 = channel.port1;
  var port2 = channel.port2;

  port2.onmessage = function (e) {
    expect(e.data).toEqual("hello");
    done();
  };

  port1.postMessage("hello");
});

test("transferable", done => {
  var channel = new MessageChannel();
  var anotherChannel = new MessageChannel();
  var port1 = channel.port1;
  var port2 = channel.port2;

  port2.onmessage = function (e) {
    expect(e.data).toEqual("hello");
    expect(e.ports).toHaveLength(1);
    expect(e.ports[0]).toBeInstanceOf(MessagePort);
    done();
  };

  port1.postMessage("hello", [anotherChannel.port2]);
});

test("non-transferable", () => {
  var channel = new MessageChannel();
  channel.port2.onmessage = function (e) {
    // not reached
    expect(1).toBe(2);
  };
  expect(() => {
    channel.port1.postMessage("hello", [channel.port1]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("hello", [channel.port2]);
  }).toThrow();
});

test("transfer message ports and post messages", done => {
  var c1 = new MessageChannel();
  var c2 = new MessageChannel();

  c1.port1.onmessage = e => {
    var port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 2");
    port.onmessage = e => {
      expect(e.data).toEqual("hello from channel 1 port 2");
      done();
    };
    port.postMessage("hello from channel 1 port 1", [c1.port1]);
  };

  c1.port2.onmessage = e => {
    var port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 2 port 1");
    port.postMessage("hello from channel 1 port 2");
  };

  c2.port1.onmessage = e => {
    var port = e.ports[0];
    expect(port).toBeInstanceOf(MessagePort);
    expect(e.data).toEqual("hello from channel 1 port 1");
    port.postMessage("hello from channel 2 port 1", [c2.port1]);
  };

  c2.port2.onmessage = e => {
    // should not be reached. onmessage defined in c1.port1 should be called instead
    expect(1).toBe(2);
  };

  c1.port2.postMessage("hello from channel 1 port 2", [c2.port2]);
});

test("message channel created on main thread", done => {
  var worker = new Worker(new URL("receive-port-worker.js", import.meta.url).href);
  worker.onerror = e => {
    expect(1).toBe(2);
    done();
  };
  var channel = new MessageChannel();
  channel.port1.onmessage = e => {
    if (e.data === "done!") return done();
    expect(e.data).toEqual("received port!");
    channel.port1.postMessage("more message!");
  };
  worker.postMessage(channel.port2, { transfer: [channel.port2] });
});

test("message channel created on other thread", done => {
  var worker = new Worker(new URL("create-port-worker.js", import.meta.url).href);
  worker.onerror = e => {
    expect(1).toBe(2);
    done();
  };
  worker.onmessage = e => {
    expect(e.data).toBeInstanceOf(MessagePort);
    var port = e.data;
    port.onmessage = e => {
      expect(e.data).toEqual("done!");
      done();
    };
    port.postMessage("hello from main thread");
  };
});

test("many message channels", done => {
  var channel = new MessageChannel();
  var channel2 = new MessageChannel();
  var channel3 = new MessageChannel();
  var channel4 = new MessageChannel();

  channel.port1.postMessage("noport");
  channel.port1.postMessage("zero ports", []);
  channel.port1.postMessage("two ports", [channel2.port1, channel2.port2]);

  // Now test various failure cases
  expect(() => {
    channel.port1.postMessage("same port", [channel.port1]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("entangled port", [channel.port2]);
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("null port", [channel3.port1, null, channel3.port2]);
  }).toThrow();
  expect(() => {
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
    channel.port1.postMessage("notAnArray", "foo");
  }).toThrow();
  expect(() => {
    channel.port1.postMessage("notASequence", [{ length: 3 }]);
  }).toThrow();

  // Should not crash (we should figure out that the array contains undefined
  // entries).
  var largePortArray = [];
  largePortArray[1234567890] = channel4.port1;
  expect(() => {
    channel.port1.postMessage("largeSequence", largePortArray);
  }).toThrow();

  channel.port1.postMessage("done");

  function testTransfers(done) {
    var channel0 = new MessageChannel();

    var c1 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port", port: c1.port1 }, [c1.port1]);
    var c2 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-port-twice", port0: c2.port1, port1: c2.port1 }, [c2.port1]);
    var c3 = new MessageChannel();
    channel0.port1.postMessage({ id: "send-two-ports", port0: c3.port1, port1: c3.port2 }, [c3.port1, c3.port2]);
    var c4 = new MessageChannel();

    // Sending host objects should throw
    expect(() => {
      channel0.port1.postMessage({ id: "host-object", hostObject: c3, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Function object should throw
    expect(() => {
      var f1 = function () {};
      channel0.port1.postMessage({ id: "function-object", function: f1, port: c4.port1 }, [c4.port1]);
    }).toThrow();

    // Sending Error object should not throw
    // expect(() => {
    //   var err = new Error();
    //   channel0.port1.postMessage({ id: "error-object", error: err, port: c4.port1 }, [c4.port1]);
    // }).not.toThrow();

    c4.port1.postMessage("Should succeed");
    channel0.port1.postMessage({ id: "done" });

    channel0.port2.onmessage = function (event) {
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
        // should not be reached
        expect(1).toBe(2);
      }
    };
  }

  channel.port2.onmessage = function (event) {
    if (event.data == "noport") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(0);
    } else if (event.data == "zero ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(0);
    } else if (event.data == "two ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(2);
    } else if (event.data == "entangled ports") {
      expect(event.ports).toBeDefined();
      expect(event.ports.length).toBe(2);
    } else if (event.data == "done") {
      testTransfers(done);
    } else {
      // should not be reached
      expect(1).toBe(2);
    }
  };
});
