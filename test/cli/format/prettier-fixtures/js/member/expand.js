const veryVeryVeryVeryVeryVeryVeryLong = doc.expandedStates[doc.expandedStates.length - 1];
const small = doc.expandedStates[doc.expandedStates.length - 1];

const promises = [
  promise.resolve().then(console.log).catch(err => {
    console.log(err)
    return null
  }),
  redis.fetch(),
  other.fetch(),
];

const promises2 = [
  promise.resolve().veryLongFunctionCall().veryLongFunctionCall().then(console.log).catch(err => {
    console.log(err)
    return null
  }),
  redis.fetch(),
  other.fetch(),
];

window.FooClient.setVars({
  locale: getFooLocale({ page }),
  authorizationToken: data.token
}).initVerify("foo_container");

window.something.FooClient.setVars({
  locale: getFooLocale({ page }),
  authorizationToken: data.token
}).initVerify("foo_container");

window.FooClient.something.setVars({
  locale: getFooLocale({ page }),
  authorizationToken: data.token
}).initVerify("foo_container");
