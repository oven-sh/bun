import { diff } from "bun:diff";
import { describe, expect, test } from "bun:test";

describe("bun:diff", () => {
  describe("basic functionality", () => {
    test("identical strings return all equal edits", () => {
      const result = diff("hello\nworld\n", "hello\nworld\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(0);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0].type).toBe("equal");
      expect(result.edits[0].oldStart).toBe(0);
      expect(result.edits[0].oldEnd).toBe(2);
      expect(result.edits[0].newStart).toBe(0);
      expect(result.edits[0].newEnd).toBe(2);
    });

    test("empty strings return no edits", () => {
      const result = diff("", "");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(0);
      expect(result.edits).toHaveLength(0);
    });

    test("single line change", () => {
      const result = diff("hello\nworld\n", "hello\nearth\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);

      // Find the edits by type
      const equalEdits = result.edits.filter(e => e.type === "equal");
      const deleteEdits = result.edits.filter(e => e.type === "delete");
      const insertEdits = result.edits.filter(e => e.type === "insert");

      expect(equalEdits.length).toBeGreaterThanOrEqual(1);
      expect(deleteEdits).toHaveLength(1);
      expect(insertEdits).toHaveLength(1);
    });
  });

  describe("insertions", () => {
    test("insert at beginning", () => {
      const result = diff("b\nc\n", "a\nb\nc\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(1);

      const insertEdits = result.edits.filter(e => e.type === "insert");
      expect(insertEdits).toHaveLength(1);
    });

    test("insert at end", () => {
      const result = diff("a\nb\n", "a\nb\nc\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(1);

      const insertEdits = result.edits.filter(e => e.type === "insert");
      expect(insertEdits).toHaveLength(1);
    });

    test("insert in middle", () => {
      const result = diff("a\nc\n", "a\nb\nc\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(1);

      const insertEdits = result.edits.filter(e => e.type === "insert");
      expect(insertEdits).toHaveLength(1);
    });

    test("insert multiple lines", () => {
      const result = diff("a\nd\n", "a\nb\nc\nd\n");

      expect(result.stats.linesAdded).toBe(2);
      expect(result.stats.linesDeleted).toBe(0);
    });

    test("insert into empty", () => {
      const result = diff("", "a\nb\nc\n");

      expect(result.stats.linesAdded).toBe(3);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.stats.hunks).toBe(1);
    });
  });

  describe("deletions", () => {
    test("delete from beginning", () => {
      const result = diff("a\nb\nc\n", "b\nc\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);

      const deleteEdits = result.edits.filter(e => e.type === "delete");
      expect(deleteEdits).toHaveLength(1);
    });

    test("delete from end", () => {
      const result = diff("a\nb\nc\n", "a\nb\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);

      const deleteEdits = result.edits.filter(e => e.type === "delete");
      expect(deleteEdits).toHaveLength(1);
    });

    test("delete from middle", () => {
      const result = diff("a\nb\nc\n", "a\nc\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);

      const deleteEdits = result.edits.filter(e => e.type === "delete");
      expect(deleteEdits).toHaveLength(1);
    });

    test("delete multiple lines", () => {
      const result = diff("a\nb\nc\nd\n", "a\nd\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(2);
    });

    test("delete all lines", () => {
      const result = diff("a\nb\nc\n", "");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(3);
      expect(result.stats.hunks).toBe(1);
    });
  });

  describe("replacements", () => {
    test("replace single line", () => {
      const result = diff("old\n", "new\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);
    });

    test("replace all lines", () => {
      const result = diff("a\nb\nc\n", "x\ny\nz\n");

      expect(result.stats.linesAdded).toBe(3);
      expect(result.stats.linesDeleted).toBe(3);
    });

    test("replace with different count", () => {
      const result = diff("a\nb\n", "x\ny\nz\n");

      expect(result.stats.linesAdded).toBe(3);
      expect(result.stats.linesDeleted).toBe(2);
    });
  });

  describe("multiple hunks", () => {
    test("two separate changes", () => {
      const oldText = "a\nb\nc\nd\ne\n";
      const newText = "a\nX\nc\nY\ne\n";
      const result = diff(oldText, newText);

      expect(result.stats.linesAdded).toBe(2);
      expect(result.stats.linesDeleted).toBe(2);
      expect(result.stats.hunks).toBe(2);
    });

    test("changes at both ends", () => {
      const oldText = "a\nb\nc\n";
      const newText = "X\nb\nY\n";
      const result = diff(oldText, newText);

      expect(result.stats.linesAdded).toBe(2);
      expect(result.stats.linesDeleted).toBe(2);
      expect(result.stats.hunks).toBe(2);
    });
  });

  describe("edge cases", () => {
    test("single line without newline", () => {
      const result = diff("hello", "hello");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0].type).toBe("equal");
    });

    test("add newline to end", () => {
      const result = diff("hello", "hello\n");

      // The content "hello" vs "hello\n" - "hello" is one line without newline
      // "hello\n" means "hello" line followed by empty after newline
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("very long identical lines", () => {
      // Use Buffer.alloc instead of .repeat() for performance in debug builds
      const longLine = Buffer.alloc(10000, "x").toString();
      const result = diff(longLine + "\n", longLine + "\n");

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0].type).toBe("equal");
    });

    test("many lines", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n") + "\n";
      const result = diff(lines, lines);

      expect(result.stats.linesAdded).toBe(0);
      expect(result.stats.linesDeleted).toBe(0);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0].type).toBe("equal");
      expect(result.edits[0].oldEnd).toBe(1000);
    });

    test("unicode content", () => {
      const result = diff("hello\n世界\n", "hello\n地球\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
      expect(result.stats.hunks).toBe(1);
    });

    test("empty lines", () => {
      const result = diff("a\n\nb\n", "a\n\n\nb\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(0);
    });

    test("whitespace-only differences", () => {
      const result = diff("hello world\n", "hello  world\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
    });

    test("tabs vs spaces", () => {
      const result = diff("hello\tworld\n", "hello world\n");

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
    });
  });

  describe("edit structure", () => {
    test("edits have correct structure", () => {
      const result = diff("a\nb\n", "a\nc\n");

      for (const edit of result.edits) {
        expect(typeof edit.type).toBe("string");
        expect(["equal", "insert", "delete"]).toContain(edit.type);
        expect(typeof edit.oldStart).toBe("number");
        expect(typeof edit.oldEnd).toBe("number");
        expect(typeof edit.newStart).toBe("number");
        expect(typeof edit.newEnd).toBe("number");
        expect(edit.oldStart).toBeLessThanOrEqual(edit.oldEnd);
        expect(edit.newStart).toBeLessThanOrEqual(edit.newEnd);
      }
    });

    test("edits are in order", () => {
      const result = diff("a\nb\nc\nd\n", "a\nX\nc\nY\n");

      let lastOldEnd = 0;
      for (const edit of result.edits) {
        expect(edit.oldStart).toBeGreaterThanOrEqual(lastOldEnd);
        lastOldEnd = edit.oldEnd;
      }
    });

    test("equal edits have matching ranges", () => {
      const result = diff("a\nb\nc\n", "a\nX\nc\n");

      const equalEdits = result.edits.filter(e => e.type === "equal");
      for (const edit of equalEdits) {
        expect(edit.oldEnd - edit.oldStart).toBe(edit.newEnd - edit.newStart);
      }
    });

    test("delete edits have zero new range", () => {
      const result = diff("a\nb\nc\n", "a\nc\n");

      const deleteEdits = result.edits.filter(e => e.type === "delete");
      for (const edit of deleteEdits) {
        expect(edit.newEnd).toBe(edit.newStart);
      }
    });

    test("insert edits have zero old range", () => {
      const result = diff("a\nc\n", "a\nb\nc\n");

      const insertEdits = result.edits.filter(e => e.type === "insert");
      for (const edit of insertEdits) {
        expect(edit.oldEnd).toBe(edit.oldStart);
      }
    });
  });

  describe("stats structure", () => {
    test("stats have correct structure", () => {
      const result = diff("a\n", "b\n");

      expect(typeof result.stats.linesAdded).toBe("number");
      expect(typeof result.stats.linesDeleted).toBe("number");
      expect(typeof result.stats.hunks).toBe("number");
      expect(result.stats.linesAdded).toBeGreaterThanOrEqual(0);
      expect(result.stats.linesDeleted).toBeGreaterThanOrEqual(0);
      expect(result.stats.hunks).toBeGreaterThanOrEqual(0);
    });

    test("stats match edit counts", () => {
      const result = diff("a\nb\nc\n", "a\nX\nY\nc\n");

      let insertCount = 0;
      let deleteCount = 0;

      for (const edit of result.edits) {
        if (edit.type === "insert") {
          insertCount += edit.newEnd - edit.newStart;
        } else if (edit.type === "delete") {
          deleteCount += edit.oldEnd - edit.oldStart;
        }
      }

      expect(result.stats.linesAdded).toBe(insertCount);
      expect(result.stats.linesDeleted).toBe(deleteCount);
    });
  });

  describe("error handling", () => {
    test("throws on non-string first argument", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff(123, "hello");
      }).toThrow();
    });

    test("throws on non-string second argument", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff("hello", 123);
      }).toThrow();
    });

    test("throws on null arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff(null, "hello");
      }).toThrow();
    });

    test("throws on undefined arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff(undefined, "hello");
      }).toThrow();
    });

    test("throws with too few arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff("hello");
      }).toThrow();
    });

    test("throws with no arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        diff();
      }).toThrow();
    });
  });

  describe("real-world scenarios", () => {
    test("code change - add function", () => {
      const oldCode = `function hello() {
  console.log("hello");
}
`;
      const newCode = `function hello() {
  console.log("hello");
}

function goodbye() {
  console.log("goodbye");
}
`;
      const result = diff(oldCode, newCode);

      expect(result.stats.linesAdded).toBeGreaterThan(0);
      expect(result.stats.linesDeleted).toBe(0);
    });

    test("code change - modify function", () => {
      const oldCode = `function greet(name) {
  console.log("Hello, " + name);
}
`;
      const newCode = `function greet(name) {
  console.log(\`Hello, \${name}!\`);
}
`;
      const result = diff(oldCode, newCode);

      expect(result.stats.linesAdded).toBe(1);
      expect(result.stats.linesDeleted).toBe(1);
    });

    test("config file change", () => {
      const oldConfig = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {}
}
`;
      const newConfig = `{
  "name": "my-app",
  "version": "1.1.0",
  "dependencies": {
    "lodash": "^4.17.21"
  }
}
`;
      const result = diff(oldConfig, newConfig);

      expect(result.stats.linesAdded).toBeGreaterThan(0);
      expect(result.stats.linesDeleted).toBeGreaterThan(0);
    });

    test("markdown document edit", () => {
      const oldDoc = `# My Document

This is a paragraph.

## Section 1

Content here.
`;
      const newDoc = `# My Document

This is an updated paragraph.

## Section 1

Content here.

## Section 2

New section.
`;
      const result = diff(oldDoc, newDoc);

      expect(result.stats.linesAdded).toBeGreaterThan(0);
    });
  });
});
