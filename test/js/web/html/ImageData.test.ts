// What wpt/imagedata-wpt.test.ts leaves out. https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedata
import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import v8 from "node:v8";
import vm from "node:vm";

const U8 = Uint8ClampedArray;
const float16 = { pixelFormat: "rgba-float16" } as const;
const construct = (...args: unknown[]) => Reflect.construct(ImageData, args) as ImageData;
const show = (it: ImageData) =>
  `${it.width}x${it.height} ${it.data.constructor.name}[${it.data.length}] ${it.colorSpace} ${it.pixelFormat}`;
function outcome(run: () => ImageData) {
  try {
    return show(run());
  } catch (error: any) {
    return `${error instanceof DOMException ? "DOMException " : ""}${error.name}: ${error.message}`;
  }
}
function detached() {
  const array = new U8(16);
  array.buffer.transfer();
  return array;
}

test("the shape of the class and of an instance", () => {
  const flags = (object: object, key: PropertyKey) => {
    const { value, get, set, ...rest } = Object.getOwnPropertyDescriptor(object, key)!;
    return { ...rest, get: typeof get, set: typeof set };
  };
  const data = { get: "undefined", set: "undefined" };
  expect(flags(globalThis, "ImageData")).toEqual({ writable: true, enumerable: false, configurable: true, ...data });
  expect([ImageData.name, ImageData.length]).toEqual(["ImageData", 2]);
  expect(Reflect.ownKeys(ImageData)).toEqual(["length", "name", "prototype"]);
  for (const key of ["width", "height", "data", "pixelFormat", "colorSpace"]) {
    expect(flags(ImageData.prototype, key)).toEqual({
      enumerable: true,
      configurable: true,
      get: "function",
      set: "undefined",
    });
    expect(() => ImageData.prototype[key]).toThrow(TypeError);
    expect(() => Reflect.get(ImageData.prototype, key, { [key]: 1 })).toThrow(TypeError);
    expect(Reflect.set(new ImageData(1, 1), key, 5)).toBe(false);
  }

  const image = new ImageData(1, 1);
  expect(Object.prototype.toString.call(image)).toBe("[object ImageData]");
  // As in Chrome and Safari.
  expect(Reflect.ownKeys(image)).toEqual(["data"]);
  expect(flags(image, "data")).toEqual({ writable: false, enumerable: true, configurable: true, ...data });
  expect(Reflect.get(ImageData.prototype, "data", image)).toBe(image.data);

  class Frame extends ImageData {}
  expect(new Frame(1, 2)).toBeInstanceOf(Frame);
  expect(show(new Frame(1, 2))).toBe("1x2 Uint8ClampedArray[8] srgb rgba-unorm8");
});

describe("new ImageData(width, height, settings)", () => {
  const one = "1x1 Uint8ClampedArray[4] srgb rgba-unorm8";
  const zero = "DOMException IndexSizeError: The width and the height must not be zero";
  const tooLarge = "DOMException IndexSizeError: The image is too large";
  const colorSpaces = `TypeError: colorSpace must be "srgb", "srgb-linear", "display-p3" or "display-p3-linear"`;
  const pixelFormats = `TypeError: pixelFormat must be "rgba-unorm8" or "rgba-float16"`;
  test.each<[unknown[], string]>([
    [[1.9, 2.9], "1x2 Uint8ClampedArray[8] srgb rgba-unorm8"],
    [["2", [3]], "2x3 Uint8ClampedArray[24] srgb rgba-unorm8"],
    [[true, { valueOf: () => 1 }], one],
    [[2 ** 32 + 1, 1], one],
    [[2 ** 32, 1], zero],
    [[NaN, 1], zero],
    [[1, Infinity], zero],
    [[null, 1], zero],
    [[undefined, undefined], zero],
    [[-1, 1], tooLarge],
    [[-1, -1], tooLarge],
    [[32768, 32768], tooLarge],
    [[2 ** 29, 1, float16], tooLarge],
    [[1n, 1], "TypeError: Conversion from 'BigInt' to 'number' is not allowed."],
    [[1, Symbol()], "TypeError: Cannot convert a symbol to a number"],
    [[1], `TypeError: The "width" and "height" arguments must be specified`],

    [[1, 1, undefined], one],
    [[1, 1, null], one],
    [[1, 1, []], one],
    [[1, 1, { colorSpace: undefined, pixelFormat: undefined }], one],
    [[1, 1, 1], `TypeError: The "settings" argument must be of type object. Received type number (1)`],
    [[0, 0, 1], `TypeError: The "settings" argument must be of type object. Received type number (1)`],
    [[1, 1, { colorSpace: "srgb-linear" }], "1x1 Uint8ClampedArray[4] srgb-linear rgba-unorm8"],
    [[1, 1, { colorSpace: "display-p3" }], "1x1 Uint8ClampedArray[4] display-p3 rgba-unorm8"],
    [[1, 1, { colorSpace: "display-p3-linear" }], "1x1 Uint8ClampedArray[4] display-p3-linear rgba-unorm8"],
    [[1, 1, { colorSpace: ["display-p3"] }], "1x1 Uint8ClampedArray[4] display-p3 rgba-unorm8"],
    [[1, 1, Object.create({ colorSpace: "display-p3" })], "1x1 Uint8ClampedArray[4] display-p3 rgba-unorm8"],
    [[1, 1, { colorSpace: "SRGB" }], colorSpaces],
    [[1, 1, { colorSpace: null }], colorSpaces],
    [[0, 0, { colorSpace: "rec2020" }], colorSpaces],
    [[2, 1, float16], "2x1 Float16Array[8] srgb rgba-float16"],
    [[1, 1, { pixelFormat: "rgba-float32" }], pixelFormats],
    [[1, 1, { pixelFormat: null }], pixelFormats],

    // Four arguments only fit the other overload.
    [
      [1, 1, undefined, undefined],
      `TypeError: The "data" argument must be an instance of Uint8ClampedArray or Float16Array. Received type number (1)`,
    ],
    [[Buffer.alloc(4), 1], "DOMException IndexSizeError: The data must be a Uint8ClampedArray or a Float16Array"],
    [
      [new Uint8Array(4), 1, 1],
      `TypeError: The "data" argument must be an instance of Uint8ClampedArray or Float16Array. Received an instance of Uint8Array`,
    ],
  ])("%p", (args, expected) => {
    expect(outcome(() => construct(...args))).toBe(expected);
  });

  test("converts its arguments in order, once each", () => {
    const log: string[] = [];
    const number = (name: string) => ({ valueOf: () => (log.push(name), 1) });
    construct(number("width"), number("height"), new Proxy({}, { get: (_, key) => void log.push(String(key)) }));
    expect(log).toEqual(["width", "height", "colorSpace", "pixelFormat"]);
  });

  test("has a buffer of its own, of zeros", () => {
    const { data } = new ImageData(40, 30);
    expect([data.byteOffset, data.buffer.byteLength, data.buffer.resizable]).toEqual([0, 4800, false]);
    expect(data).toEqual(new U8(4800));
  });
});

describe("new ImageData(data, width, height, settings)", () => {
  const empty = "DOMException InvalidStateError: The data is empty";
  const pixels = "DOMException InvalidStateError: The length of the data is not a whole number of pixels";
  const rows = "DOMException IndexSizeError: The length of the data is not a whole number of rows";
  const size = "DOMException IndexSizeError: The length of the data does not match the width and the height";
  const unstable = "TypeError: The data must not be a view of a shared or resizable buffer";
  test.each<[unknown[], string]>([
    [[new U8(8), 1, undefined], "1x2 Uint8ClampedArray[8] srgb rgba-unorm8"],
    [[new U8(8), "1", 2.5], "1x2 Uint8ClampedArray[8] srgb rgba-unorm8"],
    [[new U8(8), 2 ** 32 + 1, 2 ** 32 + 2], "1x2 Uint8ClampedArray[8] srgb rgba-unorm8"],
    [[new U8(4), 1, undefined, { colorSpace: "display-p3" }], "1x1 Uint8ClampedArray[4] display-p3 rgba-unorm8"],
    [[new U8(4), 1, 1, null, "ignored"], "1x1 Uint8ClampedArray[4] srgb rgba-unorm8"],
    [[new U8(new ArrayBuffer(16), 3, 8), 2], "2x1 Uint8ClampedArray[8] srgb rgba-unorm8"],
    [[vm.runInNewContext("new Uint8ClampedArray(4)"), 1], "1x1 Uint8ClampedArray[4] srgb rgba-unorm8"],
    [[new U8(0), 0], empty],
    [[detached(), 1], empty],
    [[new U8(3), 0], pixels],
    [[new U8(8), 0], rows],
    [[new U8(8), 3], rows],
    [[new U8(8), -1], rows],
    [[new U8(8), 1, 0], size],
    [[new U8(8), 1, null], size],
    // The settings are the fourth argument.
    [[new U8(4), 1, { colorSpace: "display-p3" }], size],
    [[new U8(new SharedArrayBuffer(4)), 1], unstable],
    [[new U8(new ArrayBuffer(4, { maxByteLength: 8 })), 1], unstable],
    [[new U8(new ArrayBuffer(4, { maxByteLength: 8 }), 0, 4), 1, 1], unstable],

    [[new Float16Array(4), 1, 1, float16], "1x1 Float16Array[4] srgb rgba-float16"],
    [[new Float16Array(6), 1, undefined, float16], pixels],
    [[new Float16Array(2), 1], `DOMException InvalidStateError: A Float16Array needs the pixelFormat "rgba-float16"`],
    [
      [new U8(8), 1, 1, float16],
      `DOMException InvalidStateError: A Uint8ClampedArray needs the pixelFormat "rgba-unorm8"`,
    ],
    // The size is looked at first, in pixels of the format that was asked for.
    [[new Float16Array(4), 1, 1], size],
    [[new U8(4), 1, 1, float16], pixels],
  ])("%p", (args, expected) => {
    expect(outcome(() => construct(...args))).toBe(expected);
  });

  test.each([1, 2, 3])("sees that the conversion of argument %i detached the data", position => {
    const data = new U8(8);
    const args: unknown[] = [data, 1, 2, {}];
    const detach = (value: unknown) => (data.buffer.transfer(), value);
    args[position] =
      position === 3
        ? {
            get colorSpace() {
              return detach("srgb");
            },
          }
        : { valueOf: () => detach(position) };
    expect(outcome(() => construct(...args))).toBe(empty);
  });

  test("keeps the data alive", () => {
    const images = Array.from({ length: 50 }, (_, i) => new ImageData(new U8(4096).fill(i), 32));
    for (const image of images) delete (image as any).data;
    Bun.gc(true);
    expect(images.map(({ data }) => [data.length, data[0], data[4095]])).toEqual(images.map((_, i) => [4096, i, i]));
  });

  test("keeps its size when the data is detached", () => {
    const image = new ImageData(2, 3);
    image.data.buffer.transfer();
    expect(show(image)).toBe("2x3 Uint8ClampedArray[0] srgb rgba-unorm8");
  });
});

test("Bun.inspect", () => {
  expect(Bun.inspect(new ImageData(new U8([1, 2, 3, 4]), 1, 1, { colorSpace: "display-p3" }))).toMatchInlineSnapshot(`
    "ImageData {
      data: Uint8ClampedArray(4) [ 1, 2, 3, 4 ],
      width: 1,
      height: 1,
      pixelFormat: "rgba-unorm8",
      colorSpace: "display-p3",
    }"
  `);
});

test("deep equality", () => {
  const image = new ImageData(2, 3);
  expect(image).toEqual(new ImageData(2, 3));
  expect(image).toStrictEqual(new ImageData(new U8(24), 2));
  expect(image).toMatchObject({ width: 2, height: 3, colorSpace: "srgb" });
  for (const other of [
    new ImageData(3, 2),
    new ImageData(2, 4),
    new ImageData(2, 3, { colorSpace: "display-p3" }),
    new ImageData(new U8(24).fill(1, 23), 2),
    new ImageData(2, 3, float16),
  ]) {
    expect(image).not.toEqual(other);
    expect(Bun.deepEquals(image, other)).toBe(false);
  }
});

describe("structured clone", () => {
  const sample = () => new ImageData(new U8([1, 2, 3, 4, 5, 6, 7, 8]), 1, 2, { colorSpace: "display-p3" });

  describe.each<[string, (value: any) => any]>([
    ["structuredClone", structuredClone],
    ["bun:jsc", value => deserialize(serialize(value))],
    ["node:v8", value => v8.deserialize(v8.serialize(value))],
  ])("%s", (_, clone) => {
    test.each(["srgb", "srgb-linear", "display-p3", "display-p3-linear"] as const)("%s", colorSpace => {
      for (const image of [
        new ImageData(new U8([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1, { colorSpace }),
        new ImageData(new Float16Array([0.5, -1, 2, 1]), 1, 1, { colorSpace, ...float16 }),
      ]) {
        const copy = clone(image);
        expect(copy).toBeInstanceOf(ImageData);
        expect(show(copy)).toBe(show(image));
        expect(copy.data).toEqual(image.data);
        expect(copy.data.buffer).not.toBe(image.data.buffer);
      }
    });

    test("what was one object stays one object, in any order", () => {
      const [image, other, after] = [sample(), new ImageData(1, 1), {}];
      const parts = { image, data: image.data, buffer: image.data.buffer };
      for (const order of [
        ["image", "data", "buffer"],
        ["data", "image", "buffer"],
        ["buffer", "data", "image"],
        ["buffer", "image", "data"],
      ]) {
        const first = Object.fromEntries(order.map(key => [key, parts[key]]));
        const copy = clone({ ...first, other, after, again: [image, other, after] });
        expect(copy.image.data).toBe(copy.data);
        expect(copy.data.buffer).toBe(copy.buffer);
        expect(copy.again[0]).toBe(copy.image);
        expect(copy.again[1]).toBe(copy.other);
        expect(copy.again[2]).toBe(copy.after);
        expect([copy.image, copy.other]).toEqual([image, other]);
      }
    });

    test("two on one array, and two on one buffer", () => {
      const buffer = new ArrayBuffer(32);
      const data = new U8(buffer, 4, 16).fill(9);
      const [a, b, c] = clone([
        new ImageData(data, 1),
        new ImageData(data, 4),
        new ImageData(new U8(buffer, 20, 8), 2),
      ]);
      expect([a, b, c].map(it => [it.width, it.height, it.data.byteOffset])).toEqual([
        [1, 4, 4],
        [4, 1, 4],
        [2, 1, 20],
      ]);
      expect(a.data).toBe(b.data);
      expect(c.data.buffer).toBe(a.data.buffer);
    });

    test("in a Map and a Set", () => {
      const [[key, value]] = clone(new Map([[sample(), new Set([sample()])]]));
      expect([key, ...value]).toEqual([sample(), sample()]);
    });

    test("leaves out what script added or replaced", () => {
      class Frame extends ImageData {
        extra = 1;
      }
      const frame = new Frame(1, 1);
      Object.defineProperty(frame, "data", { value: new U8(8) });
      Object.defineProperty(frame, "width", { value: 2 });
      const copy = clone(frame);
      expect(Object.getPrototypeOf(copy)).toBe(ImageData.prototype);
      expect(copy).toStrictEqual(new ImageData(1, 1));
    });

    test("refuses detached data", () => {
      const image = sample();
      image.data.buffer.transfer();
      expect(() => clone(image)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    });
  });

  test("the buffer can be transferred, the ImageData cannot", () => {
    const image = sample();
    expect(() => structuredClone(image, { transfer: [image as any] })).toThrow(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    expect(image).toEqual(sample());
    expect(structuredClone(image, { transfer: [image.data.buffer] })).toStrictEqual(sample());
    expect(image.data.length).toBe(0);
  });

  test("MessageChannel and BroadcastChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const [sender, receiver] = [new BroadcastChannel("ImageData"), new BroadcastChannel("ImageData")];
    try {
      const received = [port2, receiver].map(it => {
        const { promise, resolve, reject } = Promise.withResolvers();
        it.onmessage = ({ data }) => resolve(data);
        it.onmessageerror = reject;
        return promise;
      });
      port1.postMessage(sample());
      sender.postMessage(sample());
      expect(await Promise.all(received)).toStrictEqual([sample(), sample()]);
    } finally {
      for (const it of [port1, port2, sender, receiver]) it.close();
    }
  });

  test("to a Worker and back", async () => {
    using dir = tempDir("imagedata-worker", {
      "worker.js": `
        onmessage = ({ data: image }) => {
          image.data[0] = image instanceof ImageData ? 99 : 0;
          postMessage(image, [image.data.buffer]);
        };
      `,
    });
    const worker = new Worker(join(String(dir), "worker.js"));
    try {
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();
      worker.onmessage = resolve;
      worker.onerror = worker.onmessageerror = reject;
      const image = sample();
      worker.postMessage(image, [image.data.buffer]);
      expect(image.data.length).toBe(0);
      const expected = sample();
      expected.data[0] = 99;
      expect((await promise).data).toStrictEqual(expected);
    } finally {
      worker.terminate();
    }
  });

  test("to a subprocess and back", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    await using child = Bun.spawn({
      cmd: [bunExe(), "-e", `process.once("message", image => process.send([image instanceof ImageData, image]))`],
      env: bunEnv,
      ipc: resolve,
      onDisconnect: () => reject(new Error("no message came back")),
      serialization: "advanced",
    });
    child.send(sample());
    expect(await promise).toStrictEqual([true, sample()]);
    expect(await child.exited).toBe(0);
  });

  describe("a record that describes no ImageData is refused", () => {
    const IMAGE_DATA_TAG = 14;
    const bytesOf = (value: unknown) => Buffer.from(serialize(value));
    // After the version.
    const HEADER = bytesOf(sample()).indexOf(IMAGE_DATA_TAG, 1);
    const record = (width: number, colorSpace: number, data: unknown) => {
      const head = Buffer.of(IMAGE_DATA_TAG, 0, 0, 0, 0, colorSpace);
      head.writeUInt32LE(width, 1);
      const rest = bytesOf(data);
      return Buffer.concat([rest.subarray(0, HEADER), head, rest.subarray(HEADER)]);
    };

    test("this one does", () => {
      expect(record(1, 2, sample().data)).toEqual(bytesOf(sample()));
    });

    test.each<[string, Buffer]>([
      ["a width of zero", record(0, 0, new U8(8))],
      ["a width that leaves a part of a row", record(3, 0, new U8(8))],
      ["the largest width", record(2 ** 32 - 1, 0, new U8(8))],
      ["an unknown color space", record(1, 4, new U8(8))],
      ["no pixels", record(1, 0, new U8(0))],
      ["a part of a pixel", record(1, 0, new U8(6))],
      ["a part of a pixel of Float16", record(1, 0, new Float16Array(2))],
      ["a Uint8Array", record(1, 0, new Uint8Array(8))],
      ["a DataView", record(1, 0, new DataView(new ArrayBuffer(8)))],
      ["an ArrayBuffer", record(1, 0, new ArrayBuffer(8))],
      ["a view of a resizable buffer", record(1, 0, new U8(new ArrayBuffer(8, { maxByteLength: 16 })))],
      ["a number", record(1, 0, 5)],
      ["an object", record(1, 0, {})],
      ["an ImageData", record(1, 0, sample())],
      [
        "nothing but heads",
        Buffer.concat([bytesOf(sample()).subarray(0, HEADER), Buffer.alloc(6 * 100_000, Buffer.of(14, 1, 0, 0, 0, 0))]),
      ],
    ])("%s", (_, bytes) => {
      expect(() => deserialize(bytes)).toThrow(TypeError);
    });

    test("a reference to something else", () => {
      const data = new U8(4);
      const bytes = bytesOf([{}, data, new ImageData(data, 1)]);
      const at = bytes.lastIndexOf(IMAGE_DATA_TAG) + 7;
      expect(deserialize(bytes)[2]).toEqual(new ImageData(1, 1));
      const results = [0, 1, 2, 3, 4, 5].map(index => outcome(() => deserialize(bytes.with(at, index))[2]));
      expect(results.filter(it => it.startsWith("1x1"))).toHaveLength(1);
      expect(results.filter(it => it.startsWith("TypeError"))).toHaveLength(5);
    });

    test("one that is cut short", () => {
      const bytes = bytesOf(sample());
      for (let length = HEADER; length < bytes.length; length++) {
        expect(() => deserialize(bytes.subarray(0, length))).toThrow(TypeError);
      }
    });
  });
});
