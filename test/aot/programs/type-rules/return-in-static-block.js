// `return` in a class static block is an early error, also in JavaScript, where nothing else is checked.
class A { static { return; } }
