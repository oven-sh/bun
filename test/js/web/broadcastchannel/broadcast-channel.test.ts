test("postMessage results in correct event", done => {
  let c1 = new BroadcastChannel("eventType");
  let c2 = new BroadcastChannel("eventType");

  c2.onmessage = (e: MessageEvent) => {
    expect(e).toBeInstanceOf(MessageEvent);
    expect(e.target).toBe(c2);
    expect(e.type).toBe("message");
    expect(e.origin).toBe(null);
    expect(e.data).toBe("hello world");
    expect(e.source).toBe(null);
    done();
  };

  c1.postMessage("hello world");
});

test("messages are delivered in port creation order", done => {
  let c1 = new BroadcastChannel("order");
  let c2 = new BroadcastChannel("order");
  let c3 = new BroadcastChannel("order");

  let events: MessageEvent[] = [];
  let doneCount = 0;
  let handler = (e: MessageEvent) => {
    events.push(e);
    if (e.data == "done") {
      doneCount++;
      if (doneCount == 2) {
        expect(events.length).toBe(6);
        expect(events[0].target).toBe(c2);
        expect(events[0].data).toBe("from c1");
        expect(events[1].target).toBe(c3);
        expect(events[1].data).toBe("from c1");
        expect(events[2].target).toBe(c1);
        expect(events[2].data).toBe("from c3");
        expect(events[3].target).toBe(c2);
        expect(events[3].data).toBe("from c3");
        expect(events[4].target).toBe(c1);
        expect(events[4].data).toBe("done");
        expect(events[5].target).toBe(c3);
        expect(events[5].data).toBe("done");
        done();
      }
    }
  };

  c1.onmessage = handler;
  c2.onmessage = handler;
  c3.onmessage = handler;

  c1.postMessage("from c1");
  c3.postMessage("from c3");
  c2.postMessage("done");
});

test("messages aren't deliverd to a closed port.", done => {
  let c1 = new BroadcastChannel("closed");
  let c2 = new BroadcastChannel("closed");
  let c3 = new BroadcastChannel("closed");

  c2.onmessage = () => {
    expect().fail();
  };
  c2.close();
  c3.onmessage = () => {
    done();
  };
  c1.postMessage("test");
});

test("messages aren't delivered to a port closed after calling postMessage.", done => {
  let c1 = new BroadcastChannel("closed");
  let c2 = new BroadcastChannel("closed");
  let c3 = new BroadcastChannel("closed");

  c2.onmessage = () => expect().fail();
  c3.onmessage = () => done();
  c1.postMessage("test");
  c2.close();
});

test("closing and creating channels during message delivery works correctly.", done => {
  let c1 = new BroadcastChannel("create-in-onmessage");
  let c2 = new BroadcastChannel("create-in-onmessage");

  c2.onmessage = (e: MessageEvent) => {
    expect(e.data).toBe("first");
    c2.close();
    let c3 = new BroadcastChannel("create-in-onmessage");
    c3.onmessage = (event: MessageEvent) => {
      expect(event.data).toBe("done");
      done();
    };
    c1.postMessage("done");
  };
  c1.postMessage("first");
  c2.postMessage("second");
});

test("Closing a channel in onmessage prevents already queued tasks from firing onmessage events", done => {
  let c1 = new BroadcastChannel("close-in-onmessage");
  let c2 = new BroadcastChannel("close-in-onmessage");
  let c3 = new BroadcastChannel("close-in-onmessage");

  let events: string[] = [];
  c1.onmessage = (e: MessageEvent) => events.push("c1: " + e.data);
  c2.onmessage = (e: MessageEvent) => events.push("c2: " + e.data);
  c3.onmessage = (e: MessageEvent) => events.push("c3: " + e.data);

  // c2 closes itself when it receives the first message
  c2.addEventListener("message", (e: MessageEvent) => {
    c2.close();
  });

  c3.addEventListener("message", (e: MessageEvent) => {
    if (e.data == "done") {
      expect(events).toEqual(["c2: first", "c3: first", "c3: done"]);
      done();
    }
  });
  c1.postMessage("first");
  c1.postMessage("done");
});
