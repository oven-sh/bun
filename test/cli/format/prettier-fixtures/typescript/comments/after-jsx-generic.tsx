let comp = (
  <>
    <Component<number> /* comment1 */></Component>
    <Component<number> foo /* comment2 */></Component>
    <Component<number> /* comment3 */ bar></Component>
    <Component<number> foo /* comment4 */ bar></Component>

    <Component<number>
      // comment5
    ></Component>
    <Component<number>
      foo
      // comment6
    ></Component>
    <Component<number>
      // comment7
      foo
    ></Component>
    <Component<number>
      foo
      // comment8
      bar
    ></Component>
  </>
);
