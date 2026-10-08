const a = {
  [a?.b]: 1,

  [a?.b]() {},
  [a?.b]:function() {},

  *[a?.b]() {},
  [a?.b]:function*() {},

  async[a?.b]() {},
  [a?.b]:async function() {},

  async*[a?.b]() {},
  [a?.b]:async function*() {},
};

class A {
  [a?.b]= 1;

  [a?.b]() {};
  [a?.b]=function() {};

  *[a?.b]() {};
  [a?.b]=function*() {};

  async[a?.b]() {};
  [a?.b]=async function() {};

  async*[a?.b]() {};
  [a?.b]=async function*() {};
}

class B {
  static [a?.b]= 1;

  static [a?.b]() {};
  static [a?.b]=function() {};

  static *[a?.b]() {};
  static [a?.b]=function*() {};

  static async[a?.b]() {};
  static [a?.b]=async function() {};

  static async*[a?.b]() {};
  static [a?.b]=async function*() {};
}
