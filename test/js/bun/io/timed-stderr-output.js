for (let i = 0; i <= 20; i++) {
  console.error(i);
  await new Promise(r => setTimeout(r, 100));
}
