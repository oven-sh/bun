module.exports = {
  red: "#f00",
  get lightBlue() {
    console.log("GETTER:lightBlue");
    return "#0ff";
  },
};
