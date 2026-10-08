class A {
  [a?.b]?= 1;

  [a?.b]?() {};
  [a?.b]?= function () {};

  // https://github.com/babel/babel/issues/17310
  // *[a?.b]?() {};
  [a?.b]?= function *() {};

  async [a?.b]?() {};
  [a?.b]?= async function () {};

  async * [a?.b]?() {};
  [a?.b]?= async function *() {};
}

class B {
  static [a?.b]?= 1;

  static [a?.b]?() {};
  static [a?.b]?= function () {};

  static *[a?.b]?() {};
  static [a?.b]?= function *() {};

  static async [a?.b]?() {};
  static [a?.b]?= async function () {};

  static async * [a?.b]?() {};
  static [a?.b]?= async function *() {};
}
