Promise.reject(null);
Promise.reject(undefined);
Promise.reject(true);
Promise.reject(false);
Promise.reject(1);
Promise.reject(1.1);
Promise.reject(1n);
Promise.reject(Number(1));
Promise.reject(Symbol());
Promise.reject({
  toString() {
    console.log("toString() must not be called");
  },
});

process.on("uncaughtException", err => {
  console.log(err.message);
});
