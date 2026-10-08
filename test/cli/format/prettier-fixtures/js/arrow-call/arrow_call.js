const testResults = results.testResults.map(testResult =>
  formatResult(testResult, formatter, reporter)
);

it('mocks regexp instances', () => {
  expect(
    () => moduleMocker.generateFromMetadata(moduleMocker.getMetadata(/a/)),
  ).not.toThrow();
});

expect(() => asyncRequest({ url: "/test-endpoint" }))
  .toThrowError(/Required parameter/);

expect(() => asyncRequest({ url: "/test-endpoint-but-with-a-long-url" }))
  .toThrowError(/Required parameter/);

expect(() => asyncRequest({ url: "/test-endpoint-but-with-a-suuuuuuuuper-long-url" }))
  .toThrowError(/Required parameter/);

expect(() => asyncRequest({ type: "foo", url: "/test-endpoint" }))
  .not.toThrowError();

expect(() => asyncRequest({ type: "foo", url: "/test-endpoint-but-with-a-long-url" }))
  .not.toThrowError();

const a = Observable
  .fromPromise(axiosInstance.post('/carts/mine'))
  .map((response) => response.data)

const b = Observable.fromPromise(axiosInstance.get(url))
  .map((response) => response.data)

func(
  veryLoooooooooooooooooooooooongName,
  veryLooooooooooooooooooooooooongName =>
    veryLoooooooooooooooongName.something()
);

promise.then(result => result.veryLongVariable.veryLongPropertyName > someOtherVariable ? "ok" : "fail");
