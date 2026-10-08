// TSTypeParameterInstantiation
export class ClassTest extends Modal<
  // comment
  string | number | undefined
> {
}

Math.random<
  // comment
  string | number | undefined
>;

Math.random<
  // comment
  string | number | undefined
>();


// TypeAssertion
<
  // comment
  string | number | undefined
>0;

console.log(
  <
    // comment
    string | number | undefined
  >0
);
