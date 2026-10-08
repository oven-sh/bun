// https://babeljs.io/docs/babel-plugin-proposal-optional-chaining

const obj = {
  foo: {
    bar: {
      baz: 42,
    },
  },
};

const baz = obj?.foo?.bar?.baz; // 42

const safe = obj?.qux?.baz; // undefined

// Optional chaining and normal chaining can be intermixed
obj?.foo.bar?.baz; // Only access `foo` if `obj` exists, and `baz` if
                   // `bar` exists

// Example usage with bracket notation:
obj?.['foo']?.bar?.baz // 42

const obj2 = {
  foo: {
    bar: {
      baz() {
        return 42;
      },
    },
  },
};

const baz2 = obj?.foo?.bar?.baz(); // 42

const safe3 = obj?.qux?.baz(); // undefined
const safe4 = obj?.foo.bar.qux?.(); // undefined

const willThrow = obj?.foo.bar.qux(); // Error: not a function

// Top function can be called directly, too.
function test() {
  return 42;
}
test?.(); // 42

exists?.(); // undefined

const obj3 = {
  foo: {
    bar: {
      baz: class {
      },
    },
  },
};

const obj4 = {
  foo: {
    bar: {}
  },
};

const ret = delete obj?.foo?.bar?.baz; // true
