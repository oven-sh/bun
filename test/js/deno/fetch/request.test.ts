// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/request_test.ts
import { createDenoTest } from "deno:harness";
const { test, assertEquals, assertStringIncludes } = createDenoTest(import.meta.path);
test(async function fromInit() {
    const req = new Request("http://foo/", {
        body: "ahoyhoy",
        method: "POST",
        headers: {
            "test-header": "value"
        }
    });
    assertEquals("ahoyhoy", await req.text());
    assertEquals(req.url, "http://foo/");
    assertEquals(req.headers.get("test-header"), "value");
});
test(function requestNonString() {
    const nonString = {
        toString () {
            return "http://foo/";
        }
    };
    assertEquals(new Request(nonString).url, "http://foo/");
});
test(function methodNonString() {
    assertEquals(new Request("http://foo/", {
        method: undefined
    }).method, "GET");
});
test.ignore(function requestRelativeUrl() {
    assertEquals(new Request("relative-url").url, "http://js-unit-tests/foo/relative-url");
});
test(async function cloneRequestBodyStream() {
    const stream = new Request("http://foo/", {
        body: "a test body",
        method: "POST"
    }).body;
    const r1 = new Request("http://foo/", {
        body: stream,
        method: "POST"
    });
    const r2 = r1.clone();
    const b1 = await r1.text();
    const b2 = await r2.text();
    assertEquals(b1, b2);
});
test.ignore(function customInspectFunction() {
    const request = new Request("https://example.com");
    assertEquals(Deno.inspect(request), `Request {
  bodyUsed: false,
  headers: Headers {},
  method: "GET",
  redirect: "follow",
  url: "https://example.com/"
}`);
    assertStringIncludes(Deno.inspect(Request.prototype), "Request");
});
test(function requestConstructorTakeURLObjectAsParameter() {
    assertEquals(new Request(new URL("http://foo/")).url, "http://foo/");
});
