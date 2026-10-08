// What ESLint's `ast-utils.js` says about every node of each case, in the format of `bun-lint utils-core dump`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> bun dump.ts cases.jsonl > expected.jsonl
//
// The cases are those of `../semantic/cases.ts`. Offsets are in bytes of UTF-8.
//
// `ChainExpression` is not a node in `bun lint`: what is asked of the member access or the call in it is asked of the
// `ChainExpression` here, and reported under the type of what is in it.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!eslintDir || !typescriptEslintDir) throw new Error("set ESLINT_DIR and TYPESCRIPT_ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const { Linter } = fromEslint("./lib/api.js");
const astUtils = fromEslint("./lib/rules/utils/ast-utils.js");
const typescriptParser = fromEslint(join(typescriptEslintDir, "packages/parser/dist/index.js"));

let facts: string[] = [];

const rule = {
  create(context: any) {
    const sourceCode = context.sourceCode;
    const code: string = sourceCode.text;
    const toByte = new Uint32Array(code.length + 1);
    for (let i = 0, at = 0; i < code.length; i++) {
      toByte[i] = at;
      const c = code.charCodeAt(i);
      const isPair = c >= 0xd800 && c < 0xdc00 && (code.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
      if (isPair) {
        toByte[i + 1] = at;
        i++;
        at += 4;
      } else at += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      toByte[i + 1] = at;
    }
    const range = (it: any) => (it ? `${toByte[it.range[0]]}-${toByte[it.range[1]]}` : "null");
    const text = (it: unknown) => (it === null || it === undefined ? "null" : `=${it}`);
    const index = (loc: any) => toByte[sourceCode.getIndexFromLoc(loc)];

    function visit(node: any) {
      const add = (name: string, value: () => unknown, as = node) => {
        let result;
        try {
          result = value();
        } catch {
          return;
        }
        facts.push(`${name}|${as.type}|${toByte[as.range[0]]}|${toByte[as.range[1]]}|${result}`);
      };
      add("node", () => "");
      if (node.type === "Program") {
        facts.push(`prologue|Program|0|0|${astUtils.getDirectivePrologue(node).length}`);
      } else if (node.type !== "ChainExpression") {
        const inChain = node.parent.type === "ChainExpression";
        const it = inChain ? node.parent : node;
        const scope = sourceCode.getScope(it);
        add("precedence", () => astUtils.getPrecedence(it));
        add("parenthesised", () => astUtils.isParenthesised(sourceCode, it));
        add("parenthesisedText", () => astUtils.getParenthesisedText(sourceCode, it));
        add("staticString", () => text(astUtils.getStaticStringValue(it)));
        add("constant", () => astUtils.isConstant(scope, it, false));
        add("constantBoolean", () => astUtils.isConstant(scope, it, true));
        add("couldBeError", () => astUtils.couldBeError(it));
        add("callee", () => astUtils.isCallee(it));
        add("inLoop", () => astUtils.isInLoop(it));
        add("startOfStatement", () => astUtils.isStartOfExpressionStatement(it));
        add("nullOrUndefined", () => astUtils.isNullOrUndefined(it));
        add("decimalInteger", () => astUtils.isDecimalInteger(it));
        add("upperFunction", () => range(astUtils.getUpperFunction(it)));
        if (node.type === "Literal") {
          add("booleanValue", () => {
            const value = astUtils.getBooleanValue(node);
            return value === null ? "None" : `Some(${value})`;
          });
        }
        if (["MemberExpression", "CallExpression", "TSNonNullExpression"].includes(node.type)) add("chainRoot", () => inChain);
        if (
          ["MemberExpression", "Property", "PropertyDefinition", "MethodDefinition", "TSPropertySignature", "TSMethodSignature"].includes(
            node.type,
          )
        ) {
          add("staticProperty", () => text(astUtils.getStaticPropertyName(node)));
        }
        if (/^(Binary|Logical|Assignment)Expression$|^AssignmentPattern$/.test(node.type)) {
          add("sameReference", () => astUtils.isSameReference(node.left, node.right));
          add("sameReferenceStrict", () => astUtils.isSameReference(node.left, node.right, true));
          add("equalTokens", () => astUtils.equalTokens(node.left, node.right, sourceCode));
        }
        if (node.type === "Identifier") add("globalReference", () => sourceCode.isGlobalReference(node));
        if (node.type === "SequenceExpression") add("sequence", () => node.expressions.map((e: any) => range(e) + ",").join(""));
        if (it.parent.type === "ExpressionStatement") add("needsSemicolon", () => astUtils.needsPrecedingSemicolon(sourceCode, it));

        const isExported = /^Export(Named|Default)Declaration$/.test(node.parent.type) && node.parent.declaration === node;
        add("topLevel", () => astUtils.isTopLevelExpressionStatement(node));
        add("directive", () => astUtils.isDirective(node));
        add("breakable", () => astUtils.isBreakableStatement(node));
        add("emptyBlock", () => astUtils.isEmptyBlock(node));
        add("statementListParent", () => astUtils.STATEMENT_LIST_PARENTS.has((isExported ? node.parent : node).parent.type));
        add("trailing", () => range(astUtils.getTrailingStatement(node)));
        if (node.type === "BlockStatement" && node.body.length === 1) {
          add("bracesNecessary", () => astUtils.areBracesNecessary(node, sourceCode));
        }
        if (node.type === "SwitchCase") add("colon", () => range(astUtils.getSwitchCaseColonToken(node, sourceCode)));

        if (astUtils.isFunction(node)) {
          add("name", () => astUtils.getFunctionNameWithKind(node));
          add("head", () => {
            const loc = astUtils.getFunctionHeadLoc(node, sourceCode);
            return `${index(loc.start)}-${index(loc.end)}`;
          });
          add("paren", () => range(astUtils.getOpeningParenOfParams(node, sourceCode)));
          add("empty", () => astUtils.isEmptyFunction(node));
          add("prologue", () => astUtils.getDirectivePrologue(node).length);
          if (node.type !== "ArrowFunctionExpression") {
            add("defaultThis", () => astUtils.isDefaultThisBinding(node, sourceCode));
            add("defaultThisNoCap", () => astUtils.isDefaultThisBinding(node, sourceCode, { capIsConstructor: false }));
          }
        }
      }
      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const child = node[key];
        for (const one of Array.isArray(child) ? child : [child]) {
          if (one && typeof one.type === "string") visit(one);
        }
      }
    }

    return {
      "Program:exit"(program: any) {
        visit(program);
        for (const comment of sourceCode.getAllComments()) {
          const value = `${astUtils.isDirectiveComment(comment)} ${astUtils.COMMENTS_IGNORE_PATTERN.test(comment.value)}`;
          facts.push(`comment|${comment.type}|${toByte[comment.range[0]]}|${toByte[comment.range[1]]}|${value}`);
        }
      },
    };
  },
};

const linter = new Linter({ configType: "flat" });
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const it = JSON.parse(line);
  const isJavaScript = /\.[cm]?jsx?$/.test(it.filename);
  const ecmaFeatures = { jsx: it.jsx || /x$/.test(it.filename), globalReturn: it.globalReturn, impliedStrict: it.impliedStrict };
  facts = [];
  const messages = linter.verify(
    it.code,
    [
      {
        files: ["**/*", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.jsx", "**/*.d.ts"],
        linterOptions: { reportUnusedDisableDirectives: "off", noInlineConfig: true },
        languageOptions: {
          sourceType: it.sourceType ?? "module",
          ...(isJavaScript ? { ecmaVersion: it.ecmaVersion ?? "latest" } : { parser: typescriptParser }),
          parserOptions: { ecmaFeatures },
        },
        plugins: { oracle: { rules: { dump: rule } } },
        rules: { "oracle/dump": "error" },
      },
    ],
    { filename: it.filename.replace(/^.*\//, "") },
  );
  const failed = messages.some((message: any) => message.fatal || message.ruleId === null);
  console.log(JSON.stringify(failed ? { id: it.id, error: true } : { id: it.id, facts }));
}
