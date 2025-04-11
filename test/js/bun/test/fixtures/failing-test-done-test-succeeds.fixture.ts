import { test } from "bun:test";

test.failing("test.failing passes when an error is thrown", done => {
  throw new Error("test error");
  done();
});

test.failing("test.failing passes. when done() is called with an error", done => {
  done(new Error("test error"));
});

// FIXME
// test.failing("test.failing passes when done isn't called and the test times out", done => {}, { timeout: 500 });
