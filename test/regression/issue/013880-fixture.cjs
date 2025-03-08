function a() {
  try {
    new Function("throw new Error(1)")();
  } catch (e) {
    console.log(Error.prepareStackTrace);
    console.log(e.stack);
  }
}

Error.prepareStackTrace = function abc() {
  console.log("trigger");
  a();
};

new Error().stack;
