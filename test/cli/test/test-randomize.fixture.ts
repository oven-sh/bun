test.each(Array.from({ length: 100 }, (_, i) => i + 1))("many %d", item => {
  console.log(item);
});
