interface Sample {
  value: number;
}

let reads = 0;

function twice(s: Sample): number {
  return s.value * 10 + s.value;
}

const counting: Sample = {
  get value() {
    return ++reads;
  },
};

console.log(twice({ value: 3 }));
console.log(twice(counting));
console.log(reads);
console.log(twice({ value: 4 }));

export {};
