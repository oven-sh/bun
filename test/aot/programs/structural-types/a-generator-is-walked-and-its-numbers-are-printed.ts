function* numbers(): Generator<number, void, void> {
  yield 1;
  yield 2;
}

for (const n of numbers()) console.log("zzqq " + n);
