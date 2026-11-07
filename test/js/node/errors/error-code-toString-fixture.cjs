// One producer for each row that src/jsc/bindings/ErrorCode.ts makes with plain(): Node throws the error of such a row with the
// toString() that every error inherits, not with the `name [code]: message` one of its NodeError classes.
// Prints one line for what each producer throws. Node prints the same lines as Bun:
//   node --unhandled-rejections=throw error-code-toString-fixture.cjs
const producers = {
  // With --unhandled-rejections=throw and no unhandledRejection listener, the rejection becomes an uncaught exception.
  ERR_UNHANDLED_REJECTION: () =>
    new Promise((_, reject) => {
      process.once("uncaughtException", reject);
      Promise.reject(1);
    }),
};

(async () => {
  for (const [row, produce] of Object.entries(producers)) {
    try {
      await produce();
      console.log(`${row}: nothing thrown`);
    } catch (err) {
      const string = String(err);
      console.log(
        JSON.stringify({
          code: err.code,
          name: err.name,
          string: string === `${err.name}: ${err.message}` ? "name: message" : string,
          inheritsToString: err.toString === Error.prototype.toString,
        }),
      );
    }
  }
})();
