// ES5 inheritance in four ways: a prototype replaced by a literal, Object.create, `new` of the parent and Object.setPrototypeOf, with methods overridden and called through `call`.
function Animal(name, legs) {
  this.name = name;
  this.legs = legs;
  this.steps = 0;
}
Animal.prototype = {
  constructor: Animal,
  walk: function (distance) {
    this.steps += distance * this.legs;
    return this;
  },
  sound: function () {
    return 1;
  },
  score: function () {
    return this.steps + this.sound() + this.name.length;
  },
};

function Dog(name) {
  Animal.call(this, name, 4);
  this.tricks = 0;
}
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
Dog.prototype.sound = function () {
  return 7 + this.tricks;
};
Dog.prototype.learn = function () {
  this.tricks++;
  return this;
};

function Puppy(name) {
  Dog.call(this, name);
  this.age = 1;
}
Puppy.prototype = new Dog("prototype");
Puppy.prototype.constructor = Puppy;
Puppy.prototype.score = function () {
  return Dog.prototype.score.call(this) - this.age;
};

function Bird(name) {
  Animal.call(this, name, 2);
}
Object.setPrototypeOf(Bird.prototype, Animal.prototype);
Bird.prototype.sound = function () {
  return 3;
};

function make(kind, name) {
  switch (kind) {
    case 0:
      return new Dog(name);
    case 1:
      return new Puppy(name);
    case 2:
      return new Bird(name);
  }
  return new Animal(name, 6);
}

function run(count) {
  var names = ["rex", "dot", "tweety", "ant"];
  var total = 0;
  var dogs = 0;
  for (var i = 0; i < count; i++) {
    var animal = make(i & 3, names[i & 3]);
    animal.walk(i & 7).walk(1);
    if (animal instanceof Dog) {
      animal.learn();
      dogs++;
    }
    total += animal.score();
  }
  return total + dogs;
}

console.log(run(2000000));
