function checkThis() {
  if (this !== globalThis) {
    throw new Error("this is not globalThis");
  }
}

checkThis();

module.exports = {
  FORCE_COMMON_JS: true,
};
