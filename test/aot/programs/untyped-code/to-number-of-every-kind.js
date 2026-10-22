const values = [7, -3, 2147483647, -2147483648, 1.5, -0, NaN, true, false, null, undefined, "12", "", { valueOf: () => 42 }];

for (const value of values) {
  console.log(+value);
  console.log(value * 1);
}

for (const value of [Symbol(), 1n]) {
  try {
    console.log(+value);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
