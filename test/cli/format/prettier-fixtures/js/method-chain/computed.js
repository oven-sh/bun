nock(/test/)
  .matchHeader('Accept', 'application/json')
  [httpMethodNock(method)]('/foo')
  .reply(200, {
    foo: 'bar',
  });
