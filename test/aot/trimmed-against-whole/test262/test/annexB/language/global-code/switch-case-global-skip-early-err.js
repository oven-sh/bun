// This file was procedurally generated from the following sources:
// - src/annex-b-fns/global-skip-early-err.case
// - src/annex-b-fns/global/switch-case.template
/*---
description: Extension not observed when creation of variable binding would produce an early error (Function declaration in the `case` clause of a `switch` statement in the global scope)
esid: sec-web-compat-globaldeclarationinstantiation
flags: [generated, noStrict]
info: |
    B.3.3.2 Changes to GlobalDeclarationInstantiation

    [...]
    b. If replacing the FunctionDeclaration f with a VariableStatement that has
       F as a BindingIdentifier would not produce any Early Errors for script,
       then
    [...]
---*/
let f = 123;
assert.sameValue(f, 123, 'binding is not initialized to `undefined`');

switch (1) {
  case 1:
    function f() {  }
}

assert.sameValue(f, 123, 'value is not updated following evaluation');
