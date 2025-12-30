import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

describe("Bun.file().jsonl()", () => {
  test("parses basic JSONL file", async () => {
    using dir = tempDir("jsonl-basic", {
      "data.jsonl": '{"a":1}\n{"b":2}\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("returns empty array for empty file", async () => {
    using dir = tempDir("jsonl-empty-file", {
      "data.jsonl": "",
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([]);
  });

  test("handles CRLF line endings", async () => {
    using dir = tempDir("jsonl-crlf", {
      "data.jsonl": '{"a":1}\r\n{"b":2}\r\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles last line without newline", async () => {
    using dir = tempDir("jsonl-no-trailing", {
      "data.jsonl": '{"a":1}\n{"b":2}',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("skips empty lines", async () => {
    using dir = tempDir("jsonl-empty-lines", {
      "data.jsonl": '{"a":1}\n\n{"b":2}\n\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("skips whitespace-only lines", async () => {
    using dir = tempDir("jsonl-whitespace-lines", {
      "data.jsonl": '{"a":1}\n   \n{"b":2}\n\t\t\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("skips invalid JSON lines", async () => {
    using dir = tempDir("jsonl-invalid", {
      "data.jsonl": '{"a":1}\ninvalid json\n{"b":2}\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles BOM", async () => {
    using dir = tempDir("jsonl-bom", {
      "data.jsonl": '\ufeff{"a":1}\n{"b":2}\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles arrays as JSON values", async () => {
    using dir = tempDir("jsonl-arrays", {
      "data.jsonl": '[1,2,3]\n["a","b"]\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([
      [1, 2, 3],
      ["a", "b"],
    ]);
  });

  test("handles strings as JSON values", async () => {
    using dir = tempDir("jsonl-strings", {
      "data.jsonl": '"hello"\n"world"\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual(["hello", "world"]);
  });

  test("handles numbers as JSON values", async () => {
    using dir = tempDir("jsonl-numbers", {
      "data.jsonl": "42\n3.14\n-100\n",
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([42, 3.14, -100]);
  });

  test("handles null and boolean values", async () => {
    using dir = tempDir("jsonl-primitives", {
      "data.jsonl": "null\ntrue\nfalse\n",
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([null, true, false]);
  });

  test("handles nested objects", async () => {
    using dir = tempDir("jsonl-nested", {
      "data.jsonl": '{"user":{"name":"John","age":30}}\n{"data":[1,2,3]}\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ user: { name: "John", age: 30 } }, { data: [1, 2, 3] }]);
  });

  test("handles unicode content", async () => {
    using dir = tempDir("jsonl-unicode", {
      "data.jsonl": '{"emoji":"\\ud83d\\ude00"}\n{"japanese":"\\u3053\\u3093\\u306b\\u3061\\u306f"}\n',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ emoji: "\ud83d\ude00" }, { japanese: "\u3053\u3093\u306b\u3061\u306f" }]);
  });

  test("works with Blob directly", async () => {
    const blob = new Blob(['{"a":1}\n{"b":2}\n']);
    const result = await blob.jsonl();
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles single line without newline", async () => {
    using dir = tempDir("jsonl-single", {
      "data.jsonl": '{"only":"one"}',
    });
    const result = await Bun.file(`${dir}/data.jsonl`).jsonl();
    expect(result).toEqual([{ only: "one" }]);
  });
});
