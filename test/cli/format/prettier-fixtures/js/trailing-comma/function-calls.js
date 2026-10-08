const a = (param1, param2, param3) => {}

a('value', 'value2', 'value3');

a(
  'a-long-value',
  'a-really-really-long-value',
  'a-really-really-really-long-value',
);

a('value', 'value2', a('long-nested-value', 'long-nested-value2', 'long-nested-value3'));

a.b().c(
  {
    d,
  },
  () => {}
);
