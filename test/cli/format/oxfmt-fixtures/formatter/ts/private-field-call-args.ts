// Private field access should not force multi-line call arguments
class Foo {
  #t: NodeJS.Timeout | undefined = undefined;
  #v: number;

  constructor(v: number) {
    this.#v = v;
  }

  start() {
    this.#t = setInterval(() => {
      console.log();
    }, this.#v);
  }
}
