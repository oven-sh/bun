// https://github.com/oxc-project/oxc/issues/16527
x = { 'x・': 0, 'x･': 1 };
x = y['x・', 'x･'];
class A {
  'x・'() {}
  'x･'() {}
}
