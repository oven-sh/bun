// This file was procedurally generated from the following sources:
// - src/top-level-await/await-expr-nested.case
// - src/top-level-await/syntax/export-var-init.template
/*---
description: Nested AwaitExpressions (Valid syntax for top level await in export var BindingIdentifier Await_initializer)
esid: prod-AwaitExpression
features: [top-level-await]
flags: [generated, module]
info: |
    ModuleItem:
      StatementListItem[~Yield, +Await, ~Return]

    ...

    UnaryExpression[Yield, Await]
      [+Await]AwaitExpression[?Yield]

    AwaitExpression[Yield]:
      await UnaryExpression[?Yield, +Await]

    ...

    ExportDeclaration:
      export * FromClause ;
      export ExportClause FromClause ;
      export ExportClause ;
      export VariableStatement[~Yield, +Await]
      export Declaration[~Yield, +Await]
      export defaultHoistableDeclaration[~Yield, +Await, +Default]
      export defaultClassDeclaration[~Yield, +Await, +Default]
      export default[lookahead ∉ { function, async [no LineTerminator here] function, class }]AssignmentExpression[+In, ~Yield, ~Await];

    VariableStatement[Yield, Await]:
      var VariableDeclarationList[+In, ?Yield, ?Await];

    VariableDeclarationList[In, Yield, Await]:
      VariableDeclaration[?In, ?Yield, ?Await]
      VariableDeclarationList[?In, ?Yield, ?Await] , VariableDeclaration[?In, ?Yield, ?Await]

    VariableDeclaration[In, Yield, Await]:
      BindingIdentifier[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]opt
      BindingPattern[?Yield, ?Await] Initializer[?In, ?Yield, ?Await]


    TryStatement[Yield, Await, Return]:
      try Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return]
      try Block[?Yield, ?Await, ?Return] Finally[?Yield, ?Await, ?Return]
      try Block[?Yield, ?Await, ?Return] Catch[?Yield, ?Await, ?Return] Finally[?Yield, ?Await, ?Return]

    ...

    ExpressionStatement[Yield, Await]:
      [lookahead ∉ { {, function, async [no LineTerminator here] function, class, let [ }]
        Expression[+In, ?Yield, ?Await];

---*/


export var name1 = await await await await await await await await await await await await await await await 'await';
export var { x = await await await await await await await await await await await await await await await 'await' } = {};
