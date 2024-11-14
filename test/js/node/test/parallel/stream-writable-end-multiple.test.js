//#FILE: test-stream-writable-end-multiple.js
//#SHA1: db58e265a3eb8bdf7dba1cb959979059ba686f6d
//-----------------
"use strict";

const stream = require("stream");

test("stream writable end multiple", async () => {
  const writable = new stream.Writable();
  writable._write = (chunk, encoding, cb) => {
    setTimeout(() => cb(), 10);
  };

  const endCallback1 = jest.fn();
  const endCallback2 = jest.fn();
  const finishCallback = jest.fn();
  const endCallback3 = jest.fn();

  writable.end("testing ended state", endCallback1);
  writable.end(endCallback2);

  writable.on("finish", finishCallback);

  await new Promise(resolve => setTimeout(resolve, 20));

  expect(endCallback1).toHaveBeenCalledTimes(1);
  expect(endCallback2).toHaveBeenCalledTimes(1);
  expect(finishCallback).toHaveBeenCalledTimes(1);

  let ticked = false;
  writable.end(endCallback3);
  ticked = true;

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(endCallback3).toHaveBeenCalledTimes(1);
  expect(endCallback3).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "ERR_STREAM_ALREADY_FINISHED",
      message: expect.any(String),
    }),
  );
  expect(ticked).toBe(true);
});

//<#END_FILE: test-stream-writable-end-multiple.js
