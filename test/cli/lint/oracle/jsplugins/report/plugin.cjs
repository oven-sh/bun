"use strict";
// Calls `context.report()` in many ways. record.mjs records what ESLint makes of it.

const messages = { known: "Known.", withData: "With {{x}} and {{ y }}." };
const say = f => {
  try {
    return String(f());
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
};

// Reports one message: what each call returns or throws, as JSON.
const errors = meta => ({
  meta,
  create: context => ({
    Program(node) {
      const fix = fixer => fixer.remove(node);
      const report = (...args) => say(() => context.report(...args));
      const said = [
        report(),
        report({ message: "no place" }),
        report({ node: 5, message: "a number" }),
        report({ node }),
        report({ node, messageId: "known", message: "both" }),
        report({ node, messageId: "unknown" }),
        report({ node, messageId: "toString" }),
        report({ node, message: "m", fix: () => ({ range: [0, "1"], text: "" }) }),
        report({ node, message: "m", fix: () => ({ text: "" }) }),
        report({
          node,
          message: "m",
          fix: () => [
            { range: [0, 2], text: "" },
            { range: [1, 3], text: "" },
          ],
        }),
        report({ node, message: "m", fix: fixer => fixer.replaceText(node, 5) }),
        report({ node, message: "m", fix: fixer => fixer.insertTextAfterRange([0, 1]) }),
        report({ node, message: "m", fix: fixer => fixer.insertTextBefore(null, 5) }),
        report({ node, message: "m", suggest: [{ fix }] }),
        report({ node, message: "m", suggest: [{ desc: "d" }] }),
        report({ node, message: "m", suggest: [{ desc: "d", messageId: "known", fix }] }),
        report({ node, message: "m", suggest: [{ messageId: "unknown", fix }] }),
        report({ node, message: "m", fix }),
        report({ node, message: "m", suggest: [{ desc: "d", fix }] }),
        // What a fixer is.
        report({
          node,
          message: "m",
          fix(fixer) {
            const prototype = Object.getPrototypeOf(fixer);
            const { remove, removeRange } = fixer;
            throw new Error(
              [
                fixer.constructor.name,
                fixer.constructor.length,
                Object.keys(fixer).length,
                Object.getOwnPropertyNames(prototype),
                Object.keys(prototype).length,
                Object.isFrozen(fixer),
                Object.isExtensible(fixer),
                // Only the methods that take a node need to be called on a fixer.
                JSON.stringify(removeRange([0, 1])),
                say(() => remove(node)).split(":")[0],
                say(() => remove.call(Object.create(fixer), node)).split(":")[0],
              ].join(" "),
            );
          },
        }),
        [context.report.name, context.report.length, typeof context.report, "prototype" in context.report].join(),
      ];
      context.report({ loc: { line: 1, column: 0 }, message: JSON.stringify(said) });
    },
  }),
});

const results = {
  meta: { fixable: "code", hasSuggestions: true, messages },
  create(context) {
    const { report, sourceCode } = context;
    // Each report is on a line of its own, so that the order is the same everywhere.
    let line = 100;
    const at = () => ({ line: line++, column: 0 });
    return {
      // Where the nodes are, after every kind of line break.
      ExpressionStatement(node) {
        context.report({
          node,
          message: "{{ type }} {{text}}",
          data: { type: node.type, text: JSON.stringify(sourceCode.getText(node)) },
        });
      },
      "Program:exit"(node) {
        const [first, second, third] = node.body;
        for (const [message, data] of [
          ["plain", { plain: 1 }],
          ["{{a}}{{ a }}{{\ta\n}}", { a: "A" }],
          ["{{a}} {{b}} {{c}} {{d}}", { a: 0, b: null, c: undefined }],
          ["{{{a}}} {{a}b}} {{a{b}} {{}} {{ }} {{a", { a: "A" }],
          ["{{a}}", { a: "{{b}}", b: "B" }],
          ["{{a}}", { a: "$& $1 $$" }],
          ["{{toString}} {{a.b}} {{0}}", { "a.b": "dotted", 0: "zero" }],
          ["{{a}}", Object.create({ a: "inherited" })],
          ["é {{a}} \u{1F600} {{\u{1F600}}}", { a: "é\u{1F600}", "\u{1F600}": "face" }],
          ["{{a}}", undefined],
          ["{{a}}", null],
        ]) {
          report({ loc: at(), message, data });
        }
        report({ loc: at(), messageId: "known" });
        report({ loc: at(), messageId: "withData", data: { x: "X" } });
        report(first, "positional {{x}}", { x: "X" });
        report(first, "positional with a fix", null, fixer => fixer.remove(first));
        report(first, at(), "positional with loc {{x}}", { x: "X" }, fixer => fixer.remove(first));
        report({ loc: { start: at(), end: { line, column: 3 } }, message: "start and end" });
        report({ loc: { start: at() }, message: "only start" });
        report({ node: first, loc: at(), message: "node and loc" });
        report({ node: second, loc: 0, message: "a loc that is 0" });
        report({ node: second, loc: "", message: "a loc that is empty" });

        for (const fix of [
          fixer => fixer.insertTextAfter(second, "A"),
          fixer => fixer.insertTextAfterRange(second.range, "B"),
          fixer => fixer.insertTextBefore(second, "C"),
          fixer => fixer.insertTextBeforeRange(second.range, "D"),
          fixer => fixer.replaceText(second, "Eé\u{1F600}"),
          fixer => fixer.replaceTextRange(second.range, "F"),
          fixer => fixer.remove(second),
          fixer => fixer.removeRange(second.range),
          fixer => fixer.remove(sourceCode.getFirstToken(third)),
          fixer => fixer.removeRange([-1, 0]),
          () => null,
          () => undefined,
          () => [],
          () => [null],
          fixer => [fixer.remove(first)],
          fixer => [fixer.remove(third), fixer.insertTextBefore(first, "("), fixer.insertTextAfter(first, ")")],
          fixer => [
            fixer.replaceText(first, "x"),
            fixer.insertTextAfter(first, "y"),
            fixer.insertTextBefore(second, "z"),
          ],
          fixer => [
            fixer.insertTextBefore(first, "1"),
            fixer.insertTextBefore(first, "2"),
            fixer.insertTextBefore(first, "3"),
          ],
          fixer => [fixer.removeRange([-1, 0]), fixer.remove(second)],
          fixer => new Set([fixer.remove(second), fixer.remove(first)]),
          function* (fixer) {
            yield fixer.remove(second);
            yield fixer.insertTextBefore(first, "g");
          },
          function* () {},
          () => ({ range: [1, 2], text: "by hand", more: true }),
        ]) {
          report({ loc: at(), message: "fix", fix });
        }

        const fix = fixer => fixer.remove(first);
        for (const suggest of [
          [],
          null,
          [{ desc: "Plain.", fix }],
          [{ desc: "Use {{name}}.", data: { name: "b" }, fix }],
          [{ messageId: "known", fix }],
          [{ messageId: "withData", data: { x: "X", y: "Y" }, fix }],
          [{ desc: "No fix.", fix: () => null }],
          // A hole.
          [, { desc: "After a hole.", fix }],
          [
            {
              desc: "Data of all kinds.",
              data: { n: 1, b: true, nothing: null, gone: undefined, list: [1, "2"], deep: { a: {} } },
              fix,
            },
          ],
          [{ desc: "Empty data.", data: {}, fix }],
          [
            { desc: "No fix.", fix: () => null },
            { desc: "Second.", fix },
            { desc: "Merged.", fix: fixer => [fixer.remove(second), fixer.remove(first)] },
          ],
        ]) {
          report({ loc: at(), message: "suggest", suggest });
        }

        // A `fix` that reports: the inner report comes first.
        const outer = at();
        report({
          loc: outer,
          message: "outer",
          fix: fixer => (report({ loc: outer, message: "inner", fix }), fixer.remove(second)),
        });
      },
    };
  },
};

module.exports = {
  // A byte order mark, all five line breaks, and characters of one, two, three and four bytes before the nodes.
  text: '﻿a;\r\n"é"; b;\r"€"; c;\n"\u{1F600}"; d; "\u{1F600}\u{1F600}"; e; f;',
  rules: {
    "errors-all": errors({ fixable: "code", hasSuggestions: true, messages }),
    "errors-none": errors(undefined),
    "errors-old": errors({ docs: { suggestion: true } }),
    results,
  },
};
