[].forEach(key => {
  data[key]('foo')
    .then(() => console.log('bar'))
    .catch(() => console.log('baz'));
});

[].forEach(key => {
  data('foo')
    [key]('bar')
    .then(() => console.log('bar'))
    .catch(() => console.log('baz'));
});

window.Data[key]("foo")
  .then(() => a)
  .catch(() => b);
