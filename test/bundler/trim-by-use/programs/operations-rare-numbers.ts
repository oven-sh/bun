let sum = 0;
for (let i = 0; i < 5; i++) sum += Math.hypot(i, i + 1, i + 2) + Math.sin(i) + Math.cbrt(i) + Math.atan2(i, 2);
console.log(sum.toFixed(6));
