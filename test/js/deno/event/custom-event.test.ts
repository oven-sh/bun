// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/custom_event_test.ts
import { createDenoTest } from "deno:harness";
const { test, assertEquals } = createDenoTest(import.meta.path);
test(function customEventInitializedWithDetail() {
    const type = "touchstart";
    const detail = {
        message: "hello"
    };
    const customEventInit = {
        bubbles: true,
        cancelable: true,
        detail
    } as CustomEventInit;
    const event = new CustomEvent(type, customEventInit);
    assertEquals(event.bubbles, true);
    assertEquals(event.cancelable, true);
    assertEquals(event.currentTarget, null);
    assertEquals(event.detail, detail);
    assertEquals(event.isTrusted, false);
    assertEquals(event.target, null);
    assertEquals(event.type, type);
});
test(function toStringShouldBeWebCompatibility() {
    const type = "touchstart";
    const event = new CustomEvent(type, {});
    assertEquals(event.toString(), "[object CustomEvent]");
});
