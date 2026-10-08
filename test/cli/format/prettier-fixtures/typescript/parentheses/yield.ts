async function* f() {
  makeRecord = (   yield* makeRecordFactory)<ManualValue>
  makeRecord = (    yield makeRecordFactory)<ManualValue>
}
