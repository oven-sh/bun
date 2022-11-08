const EventEmitter = import.meta.require("events");
class TestClass extends EventEmitter {
  #handle = null;
  spawn() {
    this.#handle = Bun.spawn(["pwd"], {
      cwd: "/tmp",
      onExit: this.#handleOnExit.bind(this),
    });
  }
  #handleOnExit(code) {
    console.log(code);
    this.emit("exit");
  }
}

const testClass = new TestClass();
testClass.spawn();
testClass.on("exit", () => {
  console.log("exiting");
  process.exit(0);
});
