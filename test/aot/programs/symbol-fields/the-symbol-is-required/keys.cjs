const kMass = Symbol("mass");
module.exports = {
  kMass,
  kLabel: Symbol("label"),
  read(object) {
    return object[kMass] * 10;
  },
};
