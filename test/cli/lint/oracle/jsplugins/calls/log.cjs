"use strict";
// Three rules that together report every call of every listener of a file in order, as one message: the rule, the key of the listener,
// whether `this` is set, and the arguments.
const keys = {
  a: `Program|Program:exit|Identifier|Identifier:exit|*|*:exit|Literal|CallExpression|CallExpression:exit|FunctionDeclaration:exit|[name='a']
    |Identifier[name=/^[a-c]$/]|Identifier[name='a']:exit|CallExpression > Identifier|CallExpression Identifier|VariableDeclarator[init]|:function
    |:function:exit|:matches(Identifier, Literal)|:not(Identifier)|Identifier:not([name='a'])|BlockStatement > :first-child
    |BlockStatement > :last-child:exit|* > Identifier|Identifier + Identifier|Identifier ~ Identifier|onCodePathStart|onCodePathEnd
    |onCodePathSegmentStart|onCodePathSegmentEnd|onCodePathSegmentLoop`,
  b: `Identifier|*|Program:exit|ImportSpecifier|ImportSpecifier > Identifier|ExportSpecifier Identifier:exit|Property > Identifier.key
    |Property[shorthand=true] > Identifier|MemberExpression[computed=false] > .property|:statement|:expression:exit|:declaration|:pattern
    |[type='Identifier']|[range.0=0]|Literal[value=1]|Literal[raw='1']:exit|:has(Identifier)|BlockStatement:has(> ReturnStatement)|:nth-child(2)
    |:nth-last-child(1):exit|TSTypeAnnotation|TSTypeReference > Identifier|JSXIdentifier|JSXElement:exit|TemplateElement
    |onUnreachableCodePathSegmentStart|onUnreachableCodePathSegmentEnd|onCodePathStart`,
  c: `Identifier:exit|ArrowFunctionExpression|ClassBody > *|ClassDeclaration, ClassExpression|IfStatement > .test|IfStatement[alternate]
    |ReturnStatement[argument=null]|AssignmentExpression[operator='=']|A|NotAType:exit|Identifier[name]|Identifier[name][range]|Program > *:exit`,
};
const logs = new WeakMap();
const at = node => `${node.type}[${node.range}]`;

const rule = name => ({
  create(context) {
    if (!logs.has(context.sourceCode)) logs.set(context.sourceCode, []);
    const log = logs.get(context.sourceCode);
    const listeners = {};
    for (const key of keys[name].split(/\s*\|/)) {
      listeners[key] = function (first, second, third) {
        const what = !key.startsWith("on")
          ? at(first)
          : `${first.id} ${third ? `${second.id} ${at(third)}` : at(second)}`;
        log.push(`${name} ${key}${this === undefined ? "" : " with this"} ${what}`);
        // The last call of all.
        if (name === "a" && key === "onCodePathEnd" && second.type === "Program")
          context.report({ node: second, message: log.join("\n") });
      };
    }
    return listeners;
  },
});
module.exports = { meta: { name: "log" }, rules: { a: rule("a"), b: rule("b"), c: rule("c") } };
