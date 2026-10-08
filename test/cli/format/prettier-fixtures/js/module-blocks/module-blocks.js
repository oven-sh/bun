module { await 3 };

class B {
  #p() {
    module {
      class C { [this.#p]; }
    };
  }
}

const m = module {
  export const foo = "foo";
  export { foo };
};

module {
  export { foo }
};

const m = module       {};

const worker = new Worker(module {
  export const foo = "foo";
});

let m = module {
  module {
    export let foo = "foo";
  };
};

const m = module { export const foo = "foo" };

let moduleBlock = module { export let y = 1; };

foo(module { export let foo = "foo"; });

let m = module { /* foo */ };
