//#FILE: test-stream-readable-next-no-null.js
//#SHA1: b3362d071d6f13ce317db2b897ff1146441d1bea
//-----------------
"use strict";

const { Readable } = require("stream");

describe("Readable.from with null value", () => {
  it("should throw ERR_STREAM_NULL_VALUES error", async () => {
    async function* generate() {
      yield null;
    }

    const stream = Readable.from(generate());

    const errorPromise = new Promise(resolve => {
      stream.on("error", error => {
        resolve(error);
      });
    });

    const dataPromise = new Promise(resolve => {
      stream.on("data", () => {
        resolve("data");
      });
    });

    const endPromise = new Promise(resolve => {
      stream.on("end", () => {
        resolve("end");
      });
    });

    await expect(errorPromise).resolves.toEqual(
      expect.objectContaining({
        code: "ERR_STREAM_NULL_VALUES",
        name: "TypeError",
        message: expect.any(String),
      }),
    );

    await expect(Promise.race([dataPromise, endPromise, errorPromise])).resolves.not.toBe("data");
    await expect(Promise.race([dataPromise, endPromise, errorPromise])).resolves.not.toBe("end");
  });
});

//<#END_FILE: test-stream-readable-next-no-null.js
