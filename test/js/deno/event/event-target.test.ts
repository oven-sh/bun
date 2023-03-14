// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/event_target_test.ts
import { assertEquals, assertThrows } from "deno:harness";
Deno.test(function addEventListenerTest() {
    const document = new EventTarget();
    assertEquals(document.addEventListener("x", null, false), undefined);
    assertEquals(document.addEventListener("x", null, true), undefined);
    assertEquals(document.addEventListener("x", null), undefined);
});
Deno.test(function constructedEventTargetCanBeUsedAsExpected() {
    const target = new EventTarget();
    const event = new Event("foo", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = (e: Event)=>{
        assertEquals(e, event);
        ++callCount;
    };
    target.addEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 1);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
    target.removeEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
});
Deno.test(function anEventTargetCanBeSubclassed() {
    class NicerEventTarget extends EventTarget {
        on(type: string, callback: ((e: Event) => void) | null, options?: AddEventListenerOptions) {
            this.addEventListener(type, callback, options);
        }
        off(type: string, callback: ((e: Event) => void) | null, options?: EventListenerOptions) {
            this.removeEventListener(type, callback, options);
        }
    }
    const target = new NicerEventTarget();
    new Event("foo", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = ()=>{
        ++callCount;
    };
    target.on("foo", listener);
    assertEquals(callCount, 0);
    target.off("foo", listener);
    assertEquals(callCount, 0);
});
Deno.test(function removingNullEventListenerShouldSucceed() {
    const document = new EventTarget();
    assertEquals(document.removeEventListener("x", null, false), undefined);
    assertEquals(document.removeEventListener("x", null, true), undefined);
    assertEquals(document.removeEventListener("x", null), undefined);
});
Deno.test(function constructedEventTargetUseObjectPrototype() {
    const target = new EventTarget();
    const event = new Event("toString", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = (e: Event)=>{
        assertEquals(e, event);
        ++callCount;
    };
    target.addEventListener("toString", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 1);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
    target.removeEventListener("toString", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
});
Deno.test(function toStringShouldBeWebCompatible() {
    const target = new EventTarget();
    assertEquals(target.toString(), "[object EventTarget]");
});
Deno.test(function dispatchEventShouldNotThrowError() {
    let hasThrown = false;
    try {
        const target = new EventTarget();
        const event = new Event("hasOwnProperty", {
            bubbles: true,
            cancelable: false
        });
        const listener = ()=>{};
        target.addEventListener("hasOwnProperty", listener);
        target.dispatchEvent(event);
    } catch  {
        hasThrown = true;
    }
    assertEquals(hasThrown, false);
});
Deno.test(function eventTargetThisShouldDefaultToWindow() {
    const { addEventListener , dispatchEvent , removeEventListener  } = EventTarget.prototype;
    let n = 1;
    const event = new Event("hello");
    const listener = ()=>{
        n = 2;
    };
    addEventListener("hello", listener);
    window.dispatchEvent(event);
    assertEquals(n, 2);
    n = 1;
    removeEventListener("hello", listener);
    window.dispatchEvent(event);
    assertEquals(n, 1);
    window.addEventListener("hello", listener);
    dispatchEvent(event);
    assertEquals(n, 2);
    n = 1;
    window.removeEventListener("hello", listener);
    dispatchEvent(event);
    assertEquals(n, 1);
});
Deno.test(function eventTargetShouldAcceptEventListenerObject() {
    const target = new EventTarget();
    const event = new Event("foo", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = {
        handleEvent (e: Event) {
            assertEquals(e, event);
            ++callCount;
        }
    };
    target.addEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 1);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
    target.removeEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
});
Deno.test(function eventTargetShouldAcceptAsyncFunction() {
    const target = new EventTarget();
    const event = new Event("foo", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = (e: Event)=>{
        assertEquals(e, event);
        ++callCount;
    };
    target.addEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 1);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
    target.removeEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
});
Deno.test(function eventTargetShouldAcceptAsyncFunctionForEventListenerObject() {
    const target = new EventTarget();
    const event = new Event("foo", {
        bubbles: true,
        cancelable: false
    });
    let callCount = 0;
    const listener = {
        handleEvent (e: Event) {
            assertEquals(e, event);
            ++callCount;
        }
    };
    target.addEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 1);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
    target.removeEventListener("foo", listener);
    target.dispatchEvent(event);
    assertEquals(callCount, 2);
});
Deno.test(function eventTargetDispatchShouldSetTargetNoListener() {
    const target = new EventTarget();
    const event = new Event("foo");
    assertEquals(event.target, null);
    target.dispatchEvent(event);
    assertEquals(event.target, target);
});
Deno.test(function eventTargetDispatchShouldSetTargetInListener() {
    const target = new EventTarget();
    const event = new Event("foo");
    assertEquals(event.target, null);
    let called = false;
    target.addEventListener("foo", (e)=>{
        assertEquals(e.target, target);
        called = true;
    });
    target.dispatchEvent(event);
    assertEquals(called, true);
});
Deno.test(function eventTargetAddEventListenerGlobalAbort() {
    return new Promise((resolve)=>{
        const c = new AbortController();
        c.signal.addEventListener("abort", ()=>resolve());
        addEventListener("test", ()=>{}, {
            signal: c.signal
        });
        c.abort();
    });
});
Deno.test(function eventTargetBrandChecking() {
    const self = {};
    assertThrows(()=>{
        EventTarget.prototype.addEventListener.call(self, "test", null);
    }, TypeError);
    assertThrows(()=>{
        EventTarget.prototype.removeEventListener.call(self, "test", null);
    }, TypeError);
    assertThrows(()=>{
        EventTarget.prototype.dispatchEvent.call(self, new Event("test"));
    }, TypeError);
});
