import { expect, describe, it } from "bun:test";
import { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";

describe("Readable", () => {
  it("should be able to be created without _construct method defined", done => {
    const readable = new Readable({
      read() {
        this.push("Hello World!\n");
        this.push(null);
      },
    });
    expect(readable instanceof Readable).toBe(true);
    let data = "";
    readable.on("data", chunk => {
      data += chunk.toString();
    });
    readable.on("end", () => {
      expect(data).toBe("Hello World!\n");
      done();
    });
  });

  it("should be able to be piped via .pipe", done => {
    const readable = new Readable({
      read() {
        this.push("Hello World!");
        this.push(null);
      },
    });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        expect(chunk.toString()).toBe("Hello World!");
        callback();
        done();
      },
    });

    readable.pipe(writable);
  });
});

describe("Duplex", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      Duplex.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, Duplex.prototype);
    Object.setPrototypeOf(Subclass, Duplex);

    const subclass = new Subclass();
    expect(subclass instanceof Duplex).toBe(true);
  });
});

describe("Transform", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      Transform.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, Transform.prototype);
    Object.setPrototypeOf(Subclass, Transform);

    const subclass = new Subclass();
    expect(subclass instanceof Transform).toBe(true);
  });
});

describe("PassThrough", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      PassThrough.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, PassThrough.prototype);
    Object.setPrototypeOf(Subclass, PassThrough);

    const subclass = new Subclass();
    expect(subclass instanceof PassThrough).toBe(true);
  });
});
