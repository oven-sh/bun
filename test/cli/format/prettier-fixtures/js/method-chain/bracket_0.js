function a() {
  function b() {
	queryThenMutateDOM(
      () => {
        title = SomeThing.call(root, 'someLongStringThatPushesThisTextReallyFar')[0];
      }
    );
  }
}
