//#FILE: test-whatwg-events-eventtarget-this-of-listener.js
//#SHA1: 8325e99e2f04d0fbf14abd12f002da81e4a6c338
//-----------------
"use strict";

// Manually ported from: https://github.com/web-platform-tests/wpt/blob/6cef1d2087d6a07d7cc6cee8cf207eec92e27c5f/dom/events/EventTarget-this-of-listener.html

// Mock document
const document = {
  createElement: () => new EventTarget(),
  createTextNode: () => new EventTarget(),
  createDocumentFragment: () => new EventTarget(),
  createComment: () => new EventTarget(),
  createProcessingInstruction: () => new EventTarget(),
};

test("the this value inside the event listener callback should be the node", () => {
  const nodes = [
    document.createElement("p"),
    document.createTextNode("some text"),
    document.createDocumentFragment(),
    document.createComment("a comment"),
    document.createProcessingInstruction("target", "data"),
  ];

  let callCount = 0;
  for (const node of nodes) {
    node.addEventListener("someevent", function () {
      ++callCount;
      expect(this).toBe(node);
    });

    node.dispatchEvent(new Event("someevent"));
  }

  expect(callCount).toBe(nodes.length);
});

test("addEventListener should not require handleEvent to be defined on object listeners", () => {
  const nodes = [
    document.createElement("p"),
    document.createTextNode("some text"),
    document.createDocumentFragment(),
    document.createComment("a comment"),
    document.createProcessingInstruction("target", "data"),
  ];

  let callCount = 0;
  for (const node of nodes) {
    const handler = {};

    node.addEventListener("someevent", handler);
    handler.handleEvent = function () {
      ++callCount;
      expect(this).toBe(handler);
    };

    node.dispatchEvent(new Event("someevent"));
  }

  expect(callCount).toBe(nodes.length);
});

test("handleEvent properties added to a function before addEventListener are not reached", () => {
  const nodes = [
    document.createElement("p"),
    document.createTextNode("some text"),
    document.createDocumentFragment(),
    document.createComment("a comment"),
    document.createProcessingInstruction("target", "data"),
  ];

  let callCount = 0;
  for (const node of nodes) {
    function handler() {
      ++callCount;
      expect(this).toBe(node);
    }

    handler.handleEvent = () => {
      throw new Error("should not call the handleEvent method on a function");
    };

    node.addEventListener("someevent", handler);

    node.dispatchEvent(new Event("someevent"));
  }

  expect(callCount).toBe(nodes.length);
});

test("handleEvent properties added to a function after addEventListener are not reached", () => {
  const nodes = [
    document.createElement("p"),
    document.createTextNode("some text"),
    document.createDocumentFragment(),
    document.createComment("a comment"),
    document.createProcessingInstruction("target", "data"),
  ];

  let callCount = 0;
  for (const node of nodes) {
    function handler() {
      ++callCount;
      expect(this).toBe(node);
    }

    node.addEventListener("someevent", handler);

    handler.handleEvent = () => {
      throw new Error("should not call the handleEvent method on a function");
    };

    node.dispatchEvent(new Event("someevent"));
  }

  expect(callCount).toBe(nodes.length);
});

//<#END_FILE: test-whatwg-events-eventtarget-this-of-listener.js
