class Apple {
  taste = "sweet";
  size = 1;
}

class Pear {
  weight = 2.5;
  taste = "mild";
}

const made: Apple = Reflect.construct(Apple, [], Pear);
console.log(Object.keys(made).join());
console.log(JSON.stringify(made));
console.log(made.taste);
console.log(made.size);
console.log(made instanceof Apple);
console.log(made instanceof Pear);

export {};
