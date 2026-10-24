class Broken<T> extends Promise<T> {
  constructor() {
    super(() => {});
  }
}

console.log("start");
try {
  console.log("then gave", typeof new Broken<number>().then(() => 1));
} catch (error) {
  console.log("threw", error instanceof Error ? error.constructor.name : typeof error);
}
