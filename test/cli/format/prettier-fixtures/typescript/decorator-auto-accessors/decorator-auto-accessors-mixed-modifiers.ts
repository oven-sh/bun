abstract class Foo {
  accessor prop: number = 1;
  static accessor prop2: number = 1;
  accessor #prop3: number = 1;
  accessor [prop4]: number = 1;
  private accessor prop5: number = 1;
  abstract accessor prop6: number;
  private accessor #p: any;

  accessor a!: any;
  accessor aa!: any;
  abstract accessor #s;
  readonly accessor g;
}
