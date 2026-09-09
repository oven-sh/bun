// META: global=window,worker

async function readAllChunks(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  return chunks;
}

test(() => {
  assert_true('textStream' in Response.prototype, "textStream exists on Response.prototype");
  assert_true('textStream' in Request.prototype, "textStream exists on Request.prototype");
  assert_equals(typeof Response.prototype.textStream, "function", "Response.prototype.textStream is a function");
  assert_equals(typeof Request.prototype.textStream, "function", "Request.prototype.textStream is a function");
}, "textStream method existence");

promise_test(async () => {
  const response = new Response("hello world");
  assert_false(response.bodyUsed, "bodyUsed is false initially");
  const stream = response.textStream();
  assert_true(stream instanceof ReadableStream, "textStream() returns a ReadableStream");
  assert_true(response.bodyUsed, "bodyUsed becomes true immediately after calling textStream()");

  const chunks = await readAllChunks(stream);
  assert_greater_than(chunks.length, 0);
  for (const chunk of chunks) {
    assert_equals(typeof chunk, "string", "each chunk should be a string");
  }
  assert_equals(chunks.join(""), "hello world", "concatenated chunks match the body content");
}, "Response.textStream() basic functionality");

promise_test(async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "hello world"
  });
  assert_false(request.bodyUsed, "bodyUsed is false initially");
  const stream = request.textStream();
  assert_true(stream instanceof ReadableStream, "textStream() returns a ReadableStream");
  assert_true(request.bodyUsed, "bodyUsed becomes true immediately after calling textStream()");

  const chunks = await readAllChunks(stream);
  assert_greater_than(chunks.length, 0);
  for (const chunk of chunks) {
    assert_equals(typeof chunk, "string", "each chunk should be a string");
  }
  assert_equals(chunks.join(""), "hello world", "concatenated chunks match the body content");
}, "Request.textStream() basic functionality");

promise_test(async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello "));
      controller.enqueue(new TextEncoder().encode("world"));
      controller.close();
    }
  });
  const response = new Response(stream);
  const textStream = response.textStream();
  const chunks = await readAllChunks(textStream);
  assert_greater_than(chunks.length, 0);
  for (const chunk of chunks) {
    assert_equals(typeof chunk, "string");
  }
  assert_equals(chunks.join(""), "hello world");
}, "textStream() handles chunked byte stream input");

test(() => {
  const response = new Response("hello");
  response.text(); // consumes body
  assert_throws_js(TypeError, () => response.textStream());
}, "Response.textStream() on consumed body throws TypeError");

test(() => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "hello"
  });
  request.text(); // consumes body
  assert_throws_js(TypeError, () => request.textStream());
}, "Request.textStream() on consumed body throws TypeError");

test(() => {
  const response = new Response("hello");
  const reader = response.body.getReader(); // locks body
  assert_throws_js(TypeError, () => response.textStream());
}, "Response.textStream() on locked body throws TypeError");

test(() => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "hello"
  });
  const reader = request.body.getReader(); // locks body
  assert_throws_js(TypeError, () => request.textStream());
}, "Request.textStream() on locked body throws TypeError");

promise_test(async () => {
  const response = new Response();
  assert_equals(response.body, null);
  assert_false(response.bodyUsed, "bodyUsed is false initially");
  const stream1 = response.textStream();
  assert_true(stream1 instanceof ReadableStream);
  assert_false(response.bodyUsed, "bodyUsed remains false after first textStream()");
  const stream2 = response.textStream();
  assert_true(stream2 instanceof ReadableStream);
  assert_false(response.bodyUsed, "bodyUsed remains false after second textStream()");
  assert_not_equals(stream1, stream2, "multiple calls must return different stream objects");
  const chunks1 = await readAllChunks(stream1);
  assert_equals(chunks1.length, 0, "no chunks should be read from first null body textStream");
  const chunks2 = await readAllChunks(stream2);
  assert_equals(chunks2.length, 0, "no chunks should be read from second null body textStream");
}, "Response.textStream() with null body");

promise_test(async () => {
  const request = new Request("https://example.com");
  assert_equals(request.body, null);
  assert_false(request.bodyUsed, "bodyUsed is false initially");
  const stream1 = request.textStream();
  assert_true(stream1 instanceof ReadableStream);
  assert_false(request.bodyUsed, "bodyUsed remains false after first textStream()");
  const stream2 = request.textStream();
  assert_true(stream2 instanceof ReadableStream);
  assert_false(request.bodyUsed, "bodyUsed remains false after second textStream()");
  assert_not_equals(stream1, stream2, "multiple calls must return different stream objects");
  const chunks1 = await readAllChunks(stream1);
  assert_equals(chunks1.length, 0, "no chunks should be read from first null body textStream");
  const chunks2 = await readAllChunks(stream2);
  assert_equals(chunks2.length, 0, "no chunks should be read from second null body textStream");
}, "Request.textStream() with null body");

promise_test(async () => {
  const response = new Response("");
  assert_false(response.bodyUsed);
  const stream = response.textStream();
  assert_true(stream instanceof ReadableStream);
  assert_true(response.bodyUsed);
  const chunks = await readAllChunks(stream);
  assert_equals(chunks.length, 0, "no chunks should be read from empty stream");
}, "Response.textStream() with empty body");

promise_test(async () => {
  const buffer = new Uint8Array([0x68, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]); // "hello" in UTF-16LE
  const response = new Response(buffer, {
    headers: { "Content-Type": "text/plain; charset=utf-16le" }
  });
  const stream = response.textStream();
  const chunks = await readAllChunks(stream);
  assert_equals(chunks.join(""), "h\0e\0l\0l\0o\0", "ignores charset=utf-16le and decodes as UTF-8");
}, "Response.textStream() ignores Content-Type charset (UTF-16LE)");

promise_test(async () => {
  const buffer = new Uint8Array([0x68, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]); // "hello" in UTF-16LE
  const request = new Request("https://example.com", {
    method: "POST",
    body: buffer,
    headers: { "Content-Type": "text/plain; charset=utf-16le" }
  });
  const stream = request.textStream();
  const chunks = await readAllChunks(stream);
  assert_equals(chunks.join(""), "h\0e\0l\0l\0o\0", "ignores charset=utf-16le and decodes as UTF-8");
}, "Request.textStream() ignores Content-Type charset (UTF-16LE)");

promise_test(async () => {
  const response = new Response(new TextEncoder().encode("hello"), {
    headers: { "Content-Type": "text/plain; charset=invalid-charset" }
  });
  const stream = response.textStream();
  const chunks = await readAllChunks(stream);
  assert_equals(chunks.join(""), "hello", "ignores invalid-charset and decodes as UTF-8");
}, "Response.textStream() ignores invalid Content-Type charset (invalid-charset)");
