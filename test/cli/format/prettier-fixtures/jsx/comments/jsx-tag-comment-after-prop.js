// https://github.com/typescript-eslint/typescript-eslint/pull/703

const pure = () => {
  return (
      <Foo
        // one
        foo={123}
        // two
        bar="woof"
      />
  );
}