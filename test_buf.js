const { Writable: W, Duplex: D } = require("stream");

class TestWriter extends W {
  constructor(opts) {
    super(opts);
    this.buffer = [];
    this.written = 0;
  }

  _write(chunk, encoding, cb) {
    console.log("write", chunk.length);
    setTimeout(
      () => {
        this.buffer.push(chunk.toString());
        this.written += chunk.length;
        cb();
      },
      Math.floor(Math.random() * 10),
    );
  }
}

const chunks = new Array(50);
for (let i = 0; i < chunks.length; i++) {
  chunks[i] = "x".repeat(i);
}

const tw = new TestWriter({
  highWaterMark: 100,
});

chunks.forEach((chunk, i) => {
  chunk = Buffer.from(chunk);
  tw.write(chunk.toString("utf8"), null);
});

tw.end();

tw.on("finish", () => {
  for (let i = 0; i < chunks.length; i++) {
    if (tw.buffer[i] !== chunks[i]) {
      console.log("index", i, "discrepancy", tw.buffer[i].length, chunks[i].length);
    }
  }
});
