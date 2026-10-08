const a1 = (@deco class Foo {});
const a2 = (@deco class {});

(@deco class Foo {});
(@deco class {});

const b1 = []
;(@deco class Foo {})

const b2 = []
;(@deco class {})

// This is not a `ClassExpression` but `ClassDeclaration`
@deco class Foo {}
