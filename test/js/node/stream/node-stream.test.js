import { expect, describe, it } from "bun:test";
import { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import tty from "tty";

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
  it("should be able to be piped via .pipe, issue #3607", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStreamEmptyFile.txt`;
    writeFileSync(path, "");
    const stream = createReadStream(path);
    stream.on("error", err => {
      done(err);
    });

    let called = false;
    const writable = new Writable({
      write(chunk, encoding, callback) {
        called = true;
        callback();
      },
    });
    writable.on("finish", () => {
      try {
        expect(called).toBeFalse();
      } catch (err) {
        return done(err);
      }
      done();
    });

    stream.pipe(writable);
  });
  it("should be able to be piped via .pipe, issue #3668", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStream.txt`;
    writeFileSync(path, "12345");
    const stream = createReadStream(path, { start: 0, end: 4 });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        try {
          expect(chunk.toString()).toBe("12345");
        } catch (err) {
          done(err);
          return;
        }
        callback();
        done();
      },
    });

    stream.on("error", err => {
      done(err);
    });

    stream.pipe(writable);
  });
  it("should be able to be piped via .pipe, both start and end are 0", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStream2.txt`;
    writeFileSync(path, "12345");
    const stream = createReadStream(path, { start: 0, end: 0 });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        try {
          // Both start and end are inclusive and start counting at 0.
          expect(chunk.toString()).toBe("1");
        } catch (err) {
          done(err);
          return;
        }
        callback();
        done();
      },
    });

    stream.on("error", err => {
      done(err);
    });

    stream.pipe(writable);
  });
  it("should be able to be piped via .pipe with a large file", done => {
    const length = 128 * 1024;
    const data = "B".repeat(length);
    const path = `${tmpdir()}/${Date.now()}.testReadStreamLargeFile.txt`;
    writeFileSync(path, data);
    const stream = createReadStream(path, { start: 0, end: length - 1 });

    let res = "";
    let count = 0;
    const writable = new Writable({
      write(chunk, encoding, callback) {
        count += 1;
        res += chunk;
        callback();
      },
    });
    writable.on("finish", () => {
      try {
        expect(res).toEqual(data);
        expect(count).toBeGreaterThan(1);
      } catch (err) {
        return done(err);
      }
      done();
    });
    stream.on("error", err => {
      done(err);
    });
    stream.pipe(writable);
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

describe("TTY", () => {
  it("ReadStream stdin", () => {
    const rs = new tty.ReadStream(0);
    const rs1 = tty.ReadStream(0);
    expect(rs1 instanceof tty.ReadStream).toBe(true);
    expect(rs instanceof tty.ReadStream).toBe(true);
    expect(tty.isatty(rs.fd)).toBe(true);
    expect(rs.isRaw).toBe(false);
    expect(rs.isTTY).toBe(true);
    expect(rs.setRawMode).toBeInstanceOf(Function);
    expect(rs.setRawMode(true)).toBe(rs);
    expect(rs.isRaw).toBe(true);
    expect(rs.setRawMode(false)).toBe(rs);
    expect(rs.isRaw).toBe(false);
  });

  it("ReadStream not a tty", () => {
    const rs = new tty.ReadStream(6);
    expect(rs instanceof tty.ReadStream).toBe(true);
    expect(rs.isTTY).toBe(false);
    expect(tty.isatty(rs.fd)).toBe(false);
  });

  it("WriteStream stdout", () => {
    const ws = new tty.WriteStream(1);
    const ws1 = tty.WriteStream(1);
    expect(ws1 instanceof tty.WriteStream).toBe(true);
    expect(ws instanceof tty.WriteStream).toBe(true);
    expect(tty.isatty(ws.fd)).toBe(true);
    expect(ws.isTTY).toBe(true);
    expect(ws.columns).toBeGreaterThan(0);
    expect(ws.rows).toBeGreaterThan(0);
    expect(ws.getColorDepth()).toBeGreaterThanOrEqual(0);
    expect(ws.hasColors(2)).toBe(true);
  });

  it("process.stdio tty", () => {
    expect(process.stdin instanceof tty.ReadStream).toBe(true);
    expect(process.stdout instanceof tty.WriteStream).toBe(true);
    expect(process.stderr instanceof tty.WriteStream).toBe(true);
    expect(process.stdin.isTTY).toBe(true);
    expect(process.stdout.isTTY).toBe(true);
    expect(process.stderr.isTTY).toBe(true);
  });
});
