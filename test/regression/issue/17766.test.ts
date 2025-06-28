test("17766 minimal", () => {
  expect(/^(?:H|Hangul)$/.test("Hangul")).toBe(true);
});
test("17766 acorn", () => {
  expect(require("acorn").parse("/\\p{Script=Hangul}/u", { ecmaVersion: 2025 })).toMatchInlineSnapshot(`
    Node {
      "body": [
        Node {
          "end": 20,
          "expression": Node {
            "end": 20,
            "raw": "/\\p{Script=Hangul}/u",
            "regex": {
              "flags": "u",
              "pattern": "\\p{Script=Hangul}",
            },
            "start": 0,
            "type": "Literal",
            "value": /\\p{Script=Hangul}/u,
          },
          "start": 0,
          "type": "ExpressionStatement",
        },
      ],
      "end": 20,
      "sourceType": "script",
      "start": 0,
      "type": "Program",
    }
  `);
});
