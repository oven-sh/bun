// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/abort_controller_test.ts
import { createDenoTest } from "deno:harness";
const { test, assert, assertEquals } = createDenoTest(import.meta.path);
test(function basicAbortController() {
    const controller = new AbortController();
    assert(controller);
    const { signal  } = controller;
    assert(signal);
    assertEquals(signal.aborted, false);
    controller.abort();
    assertEquals(signal.aborted, true);
});
test(function signalCallsOnabort() {
    const controller = new AbortController();
    const { signal  } = controller;
    let called = false;
    signal.onabort = (evt)=>{
        assert(evt);
        assertEquals(evt.type, "abort");
        called = true;
    };
    controller.abort();
    assert(called);
});
test(function signalEventListener() {
    const controller = new AbortController();
    const { signal  } = controller;
    let called = false;
    signal.addEventListener("abort", function(ev) {
        assert(this === signal);
        assertEquals(ev.type, "abort");
        called = true;
    });
    controller.abort();
    assert(called);
});
test(function onlyAbortsOnce() {
    const controller = new AbortController();
    const { signal  } = controller;
    let called = 0;
    signal.addEventListener("abort", ()=>called++);
    signal.onabort = ()=>{
        called++;
    };
    controller.abort();
    assertEquals(called, 2);
    controller.abort();
    assertEquals(called, 2);
});
test(function controllerHasProperToString() {
    const actual = Object.prototype.toString.call(new AbortController());
    assertEquals(actual, "[object AbortController]");
});
test(function abortReason() {
    const signal = AbortSignal.abort("hey!");
    assertEquals(signal.aborted, true);
    assertEquals(signal.reason, "hey!");
});
