// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/body_test.ts
import { createDenoTest } from "deno:harness";
const { test, assert, assertEquals } = createDenoTest(import.meta.path);
function buildBody(body: any, headers?: Headers): Body {
    const stub = new Request("http://foo/", {
        body: body,
        headers,
        method: "POST"
    });
    return stub as Body;
}
const intArrays = [
    Int8Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Uint8ClampedArray,
    Float32Array,
    Float64Array
];
test(async function arrayBufferFromByteArrays() {
    const buffer = new TextEncoder().encode("ahoyhoy8").buffer;
    for (const type of intArrays){
        const body = buildBody(new type(buffer));
        const text = new TextDecoder("utf-8").decode(await body.arrayBuffer());
        assertEquals(text, "ahoyhoy8");
    }
});
test({
    ignore: true,
    permissions: {
        net: true
    }
}, async function bodyMultipartFormData() {
    const response = await fetch("http://localhost:" + PORT + "/multipart_form_data.txt");
    assert(response.body instanceof ReadableStream);
    const text = await response.text();
    const body = buildBody(text, response.headers);
    const formData = await body.formData();
    assert(formData.has("field_1"));
    assertEquals(formData.get("field_1")!.toString(), "value_1 \r\n");
    assert(formData.has("field_2"));
});
test({
    ignore: true,
    permissions: {
        net: true
    }
}, async function bodyURLEncodedFormData() {
    const response = await fetch("http://localhost:" + PORT + "/subdir/form_urlencoded.txt");
    assert(response.body instanceof ReadableStream);
    const text = await response.text();
    const body = buildBody(text, response.headers);
    const formData = await body.formData();
    assert(formData.has("field_1"));
    assertEquals(formData.get("field_1")!.toString(), "Hi");
    assert(formData.has("field_2"));
    assertEquals(formData.get("field_2")!.toString(), "<Deno>");
});
test({
    permissions: {}
}, async function bodyURLSearchParams() {
    const body = buildBody(new URLSearchParams({
        hello: "world"
    }));
    const text = await body.text();
    assertEquals(text, "hello=world");
});
test(async function bodyArrayBufferMultipleParts() {
    const parts: Uint8Array[] = [];
    let size = 0;
    for(let i = 0; i <= 15000; i++){
        const part = new Uint8Array([
            1
        ]);
        parts.push(part);
        size += part.length;
    }
    let offset = 0;
    const stream = new ReadableStream({
        pull (controller) {
            const chunk = parts[offset++];
            if (!chunk) return controller.close();
            controller.enqueue(chunk);
        }
    });
    const body = buildBody(stream);
    assertEquals((await body.arrayBuffer()).byteLength, size);
});
