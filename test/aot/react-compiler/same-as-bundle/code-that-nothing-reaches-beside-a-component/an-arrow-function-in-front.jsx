export const useArrow = (a) => {
  "use memo";
  return [a, "arrow"];
}
class NeverMade {
  run() {
    return 1;
  }
}
