// Fixture for regression test #8757
// When run via a symlink, import.meta.main should still be true

console.log(process.argv[1]);
console.log(Bun.main);
console.log(import.meta.main);
console.log(import.meta.dir);
console.log(import.meta.file);
console.log(import.meta.path);
