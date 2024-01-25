// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/event_test.ts
import { createDenoTest } from "deno:harness";
const { test, assert, assertEquals, assertStringIncludes } = createDenoTest(import.meta.path);
test(function eventInitializedWithType() {
    const type = "click";
    const event = new Event(type);
    assertEquals(event.isTrusted, false);
    assertEquals(event.target, null);
    assertEquals(event.currentTarget, null);
    assertEquals(event.type, "click");
    assertEquals(event.bubbles, false);
    assertEquals(event.cancelable, false);
});
test(function eventInitializedWithTypeAndDict() {
    const init = "submit";
    const eventInit = {
        bubbles: true,
        cancelable: true
    } as EventInit;
    const event = new Event(init, eventInit);
    assertEquals(event.isTrusted, false);
    assertEquals(event.target, null);
    assertEquals(event.currentTarget, null);
    assertEquals(event.type, "submit");
    assertEquals(event.bubbles, true);
    assertEquals(event.cancelable, true);
});
test(function eventComposedPathSuccess() {
    const type = "click";
    const event = new Event(type);
    const composedPath = event.composedPath();
    assertEquals(composedPath, []);
});
test(function eventStopPropagationSuccess() {
    const type = "click";
    const event = new Event(type);
    assertEquals(event.cancelBubble, false);
    event.stopPropagation();
    assertEquals(event.cancelBubble, true);
});
test(function eventStopImmediatePropagationSuccess() {
    const type = "click";
    const event = new Event(type);
    assertEquals(event.cancelBubble, false);
    event.stopImmediatePropagation();
    assertEquals(event.cancelBubble, true);
});
test(function eventPreventDefaultSuccess() {
    const type = "click";
    const event = new Event(type);
    assertEquals(event.defaultPrevented, false);
    event.preventDefault();
    assertEquals(event.defaultPrevented, false);
    const eventInit = {
        bubbles: true,
        cancelable: true
    } as EventInit;
    const cancelableEvent = new Event(type, eventInit);
    assertEquals(cancelableEvent.defaultPrevented, false);
    cancelableEvent.preventDefault();
    assertEquals(cancelableEvent.defaultPrevented, true);
});
test(function eventInitializedWithNonStringType() {
    const type: any = undefined;
    const event = new Event(type);
    assertEquals(event.isTrusted, false);
    assertEquals(event.target, null);
    assertEquals(event.currentTarget, null);
    assertEquals(event.type, "undefined");
    assertEquals(event.bubbles, false);
    assertEquals(event.cancelable, false);
});
test(function eventIsTrusted() {
    const desc1 = Object.getOwnPropertyDescriptor(new Event("x"), "isTrusted");
    assert(desc1);
    assertEquals(typeof desc1.get, "function");
    const desc2 = Object.getOwnPropertyDescriptor(new Event("x"), "isTrusted");
    assert(desc2);
    assertEquals(typeof desc2!.get, "function");
    assertEquals(desc1!.get, desc2!.get);
});
test.ignore(function eventInspectOutput() {
    const cases: Array<[any, (event: any) => string]> = [
        [
            new Event("test"),
            (event: Event)=>`Event {\n  bubbles: false,\n  cancelable: false,\n  composed: false,\n  currentTarget: null,\n  defaultPrevented: false,\n  eventPhase: 0,\n  srcElement: null,\n  target: null,\n  returnValue: true,\n  timeStamp: ${event.timeStamp},\n  type: "test"\n}`
        ],
        [
            new ErrorEvent("error"),
            (event: Event)=>`ErrorEvent {\n  bubbles: false,\n  cancelable: false,\n  composed: false,\n  currentTarget: null,\n  defaultPrevented: false,\n  eventPhase: 0,\n  srcElement: null,\n  target: null,\n  returnValue: true,\n  timeStamp: ${event.timeStamp},\n  type: "error",\n  message: "",\n  filename: "",\n  lineno: 0,\n  colno: 0,\n  error: undefined\n}`
        ],
        [
            new CloseEvent("close"),
            (event: Event)=>`CloseEvent {\n  bubbles: false,\n  cancelable: false,\n  composed: false,\n  currentTarget: null,\n  defaultPrevented: false,\n  eventPhase: 0,\n  srcElement: null,\n  target: null,\n  returnValue: true,\n  timeStamp: ${event.timeStamp},\n  type: "close",\n  wasClean: false,\n  code: 0,\n  reason: ""\n}`
        ],
        [
            new CustomEvent("custom"),
            (event: Event)=>`CustomEvent {\n  bubbles: false,\n  cancelable: false,\n  composed: false,\n  currentTarget: null,\n  defaultPrevented: false,\n  eventPhase: 0,\n  srcElement: null,\n  target: null,\n  returnValue: true,\n  timeStamp: ${event.timeStamp},\n  type: "custom",\n  detail: undefined\n}`
        ],
        [
            new ProgressEvent("progress"),
            (event: Event)=>`ProgressEvent {\n  bubbles: false,\n  cancelable: false,\n  composed: false,\n  currentTarget: null,\n  defaultPrevented: false,\n  eventPhase: 0,\n  srcElement: null,\n  target: null,\n  returnValue: true,\n  timeStamp: ${event.timeStamp},\n  type: "progress",\n  lengthComputable: false,\n  loaded: 0,\n  total: 0\n}`
        ]
    ];
    for (const [event, outputProvider] of cases){
        assertEquals(Deno.inspect(event), outputProvider(event));
    }
});
test.ignore(function inspectEvent() {
    assertEquals(Deno.inspect(Event.prototype), `Event {
  bubbles: [Getter],
  cancelable: [Getter],
  composed: [Getter],
  currentTarget: [Getter],
  defaultPrevented: [Getter],
  eventPhase: [Getter],
  srcElement: [Getter/Setter],
  target: [Getter],
  returnValue: [Getter/Setter],
  timeStamp: [Getter],
  type: [Getter]
}`);
    assertStringIncludes(Deno.inspect(new Event("test")), `Event {\n  bubbles: false,\n  cancelable: false,`);
});
