function above() {
  return "above";
}
const constantAbove = () => "constant above";

globalThis.handedOut = below;
throw new Error("the module stops here");

function below() {
  return "below, " + above() + ", " + constantAbove();
}
