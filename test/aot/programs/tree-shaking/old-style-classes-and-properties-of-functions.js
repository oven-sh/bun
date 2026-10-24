// Constructor functions with methods stored into the prototype, statics stored into the function, inheritance by Object.create and util-style inherits, and a function that holds helpers as properties.
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " " + sound(); };
Animal.create = function (name) { return new Animal(name); };
function sound() { return "makes a sound"; }

function Dog(name) { Animal.call(this, name); }
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
Dog.prototype.fetch = fetchStick;
function fetchStick() { return this.name + " fetches"; }

function tool() { return tool.prefix() + "tool"; }
tool.prefix = prefix;
function prefix() { return "a "; }

function NeverConstructed() {}
NeverConstructed.prototype.method = function () { return neverCalled(); };
function neverCalled() { return "never"; }

console.log(Animal.create("cat").speak());
console.log(new Dog("rex").speak(), new Dog("rex").fetch(), new Dog("rex") instanceof Animal);
console.log(tool());
