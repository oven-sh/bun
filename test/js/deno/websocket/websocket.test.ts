// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/websocket_test.ts
import { assertEquals, assertThrows, deferred, fail } from "deno:harness";
Deno.test({
    permissions: "none"
}, function websocketPermissionless() {
    assertThrows(()=>new WebSocket("ws://localhost"), Deno.errors.PermissionDenied);
});
Deno.test(async function websocketConstructorTakeURLObjectAsParameter() {
    const promise = deferred();
    const ws = new WebSocket(new URL("ws://localhost:4242/"));
    assertEquals(ws.url, "ws://localhost:4242/");
    ws.onerror = ()=>fail();
    ws.onopen = ()=>ws.close();
    ws.onclose = ()=>{
        promise.resolve();
    };
    await promise;
});
