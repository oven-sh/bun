const args = eval(`(${process.argv[2]})()`);
console.table(...args);
