a = {
  parseFunctionBodyAndFinish<
    T extends
      | N.Function
      | N.TSDeclareMethod
      | N.TSDeclareFunction
      | N.ClassPrivateMethod,
  >() {}
}
a = {
  parseFunctionBodyAndFinish<
    T =
      | N.Function
      | N.TSDeclareMethod
      | N.TSDeclareFunction
      | N.ClassPrivateMethod,
  >() {}
}

function parseFunctionBodyAndFinish<
  T extends
    | N.Function
    | N.TSDeclareMethod
    | N.TSDeclareFunction
    | N.ClassPrivateMethod
    | Foo
    | Bar
    | Baz
>();
function parseFunctionBodyAndFinish<
  T =
    | N.Function
    | N.TSDeclareMethod
    | N.TSDeclareFunction
    | N.ClassPrivateMethod
    | Foo
    | Bar
    | Baz
>();

function parseFunctionBodyAndFinish<
  T extends // comment
    N.Function | N.TSDeclareMethod | Baz
>();
function parseFunctionBodyAndFinish<
  T = // comment
    N.Function | N.TSDeclareMethod | Baz
>();

function makeChainWalker<
  ArgT extends {
    options: ValidatedOptions;
    dirname: string;
    filepath?: string;
  },
>() {}
function makeChainWalker2<
  ArgT = {
    options: ValidatedOptions;
    dirname: string;
    filepath?: string;
  },
>() {}
