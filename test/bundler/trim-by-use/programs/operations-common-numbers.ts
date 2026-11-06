const unknown: any[] = [7, 2.5, 10n];
console.log(-unknown[0], ~unknown[0], unknown[0] >>> 1, 2 ** unknown[1], unknown[0] ^ 3, unknown[2] * 3n);
