// This file was procedurally generated from the following sources:
// - src/arguments/args-trailing-comma-single-args.case
// - src/arguments/default/cls-decl-private-gen-meth-static.template
/*---
description: A trailing comma should not increase the arguments.length, using a single arg (class declaration private generator method)
esid: sec-argument-lists-runtime-semantics-argumentlistevaluation
features: [generators, class, class-static-methods-private]
flags: [generated]
info: |
    9.4.4 Arguments Exotic Objects

    Most ECMAScript functions make an arguments object available to their code. Depending upon the
    characteristics of the function definition, its arguments object is either an ordinary object
    or an arguments exotic object.


    Trailing comma in the arguments list

    Left-Hand-Side Expressions

    Arguments :
        ( )
        ( ArgumentList )
        ( ArgumentList , )

    ArgumentList :
        AssignmentExpression
        ... AssignmentExpression
        ArgumentList , AssignmentExpression
        ArgumentList , ... AssignmentExpression
---*/


var callCount = 0;
class C {
  static * #method() {
    assert.sameValue(arguments.length, 1);
    assert.sameValue(arguments[0], 42);
    callCount = callCount + 1;
  }

  static get method() {
    return this.#method;
  }
}

C.method(42,).next();

assert.sameValue(callCount, 1, 'method invoked exactly once');
