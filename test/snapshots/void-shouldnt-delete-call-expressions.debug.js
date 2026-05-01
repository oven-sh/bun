var was_called = false;
function thisShouldBeCalled() {
  was_called = true;
}
thisShouldBeCalled();
export function test() {
  if (!was_called)
    throw new Error("Expected thisShouldBeCalled to be called");
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/void-shouldnt-delete-call-expressions.js.map
