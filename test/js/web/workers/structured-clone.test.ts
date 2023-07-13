describe("structured clone", () => {
  let primitives_tests = [
    { description: "primitive undefined", value: undefined },
    { description: "primitive null", value: null },
    { description: "primitive true", value: true },
    { description: "primitive false", value: false },
    { description: "primitive string, empty string", value: "" },
    { description: "primitive string, lone high surrogate", value: "\uD800" },
    { description: "primitive string, lone low surrogate", value: "\uDC00" },
    { description: "primitive string, NUL", value: "\u0000" },
    { description: "primitive string, astral character", value: "\uDBFF\uDFFD" },
    { description: "primitive number, 0.2", value: 0.2 },
    { description: "primitive number, 0", value: 0 },
    { description: "primitive number, -0", value: -0 },
    { description: "primitive number, NaN", value: NaN },
    { description: "primitive number, Infinity", value: Infinity },
    { description: "primitive number, -Infinity", value: -Infinity },
    { description: "primitive number, 9007199254740992", value: 9007199254740992 },
    { description: "primitive number, -9007199254740992", value: -9007199254740992 },
    { description: "primitive number, 9007199254740994", value: 9007199254740994 },
    { description: "primitive number, -9007199254740994", value: -9007199254740994 },
    { description: "primitive BigInt, 0n", value: 0n },
    { description: "primitive BigInt, -0n", value: -0n },
    { description: "primitive BigInt, -9007199254740994000n", value: -9007199254740994000n },
    {
      description: "primitive BigInt, -9007199254740994000900719925474099400090071992547409940009007199254740994000n",
      value: -9007199254740994000900719925474099400090071992547409940009007199254740994000n,
    },
  ];
  for (let { description, value } of primitives_tests) {
    test(description, () => {
      var cloned = structuredClone(value);
      expect(cloned).toBe(value);
    });
  }

  test("Array with primitives", () => {
    var input = [
      undefined,
      null,
      true,
      false,
      "",
      "\uD800",
      "\uDC00",
      "\u0000",
      "\uDBFF\uDFFD",
      0.2,
      0,
      -0,
      NaN,
      Infinity,
      -Infinity,
      9007199254740992,
      -9007199254740992,
      9007199254740994,
      -9007199254740994,
      -12n,
      -0n,
      0n,
    ];
    var cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Array);
    expect(cloned).not.toBe(input);
    expect(cloned.length).toEqual(input.length);
    for (const x in input) {
      expect(cloned[x]).toBe(input[x]);
    }
  });
  test("Object with primitives", () => {
    var input: any = {
      undefined: undefined,
      null: null,
      true: true,
      false: false,
      empty: "",
      "high surrogate": "\uD800",
      "low surrogate": "\uDC00",
      nul: "\u0000",
      astral: "\uDBFF\uDFFD",
      "0.2": 0.2,
      "0": 0,
      "-0": -0,
      NaN: NaN,
      Infinity: Infinity,
      "-Infinity": -Infinity,
      "9007199254740992": 9007199254740992,
      "-9007199254740992": -9007199254740992,
      "9007199254740994": 9007199254740994,
      "-9007199254740994": -9007199254740994,
      "-12n": -12n,
      "-0n": -0n,
      "0n": 0n,
    };
    var cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Object);
    expect(cloned).not.toBeInstanceOf(Array);
    expect(cloned).not.toBe(input);
    for (const x in input) {
      expect(cloned[x]).toBe(input[x]);
    }
  });

  describe("bun blobs work", () => {
    test("simple", () => {
      const blob = new Blob(["hello"], { type: "application/octet-stream" });
      const cloned = structuredClone(blob);
      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned).not.toBe(blob);
      expect(cloned.size).toBe(blob.size);
      expect(cloned.type).toBe(blob.type);
    });
    test("empty", () => {
      const emptyBlob = new Blob([], { type: "" });
      const clonedEmpty = structuredClone(emptyBlob);
      expect(clonedEmpty).toBeInstanceOf(Blob);
      expect(clonedEmpty).not.toBe(emptyBlob);
      expect(clonedEmpty.size).toBe(emptyBlob.size);
      expect(clonedEmpty.type).toBe(emptyBlob.type);
    });
    test("unknown type", () => {
      const blob = new Blob(["hello type"], { type: "this is type" });
      const cloned = structuredClone(blob);
      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned).not.toBe(blob);
      expect(cloned.size).toBe(blob.size);
      expect(cloned.type).toBe(blob.type);
    });
  });

  describe("transferrables", () => {
    test("ArrayBuffer", () => {
      const buffer = Uint8Array.from([1]).buffer;
      const cloned = structuredClone(buffer, { transfer: [buffer] });
      expect(buffer.byteLength).toBe(0);
      expect(cloned.byteLength).toBe(1);
    });
    test("A detached ArrayBuffer cannot be transferred", () => {
      const buffer = new ArrayBuffer(2);
      const cloned = structuredClone(buffer, { transfer: [buffer] });
      expect(() => {
        structuredClone(buffer, { transfer: [buffer] });
      }).toThrow(DOMException);
    });
    test("Transferring a non-transferable platform object fails", () => {
      const blob = new Blob();
      expect(() => {
        structuredClone(blob, { transfer: [blob] });
      }).toThrow(DOMException);
    });
  });
});
