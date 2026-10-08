function* mySagas() {
  yield effects.takeEvery(
    rexpress.actionTypes.REQUEST_START,
    function*({ id }) {
      console.log(id);
      yield rexpress.actions(store).writeHead(id, 400);
      yield rexpress.actions(store).end(id, 'pong');
      console.log('pong');
    }
  );
}

function mySagas2() {
  return effects.takeEvery(
    rexpress.actionTypes.REQUEST_START,
    function({ id }) {
      console.log(id);
    }
  );
}
