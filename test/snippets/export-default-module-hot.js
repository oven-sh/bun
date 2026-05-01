// This test passes if there's no syntax error
export default typeof module !== "undefined" && module.id;

export function test() {
  testDone(import.meta.url);
}
