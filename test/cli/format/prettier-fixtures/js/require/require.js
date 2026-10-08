const { one, two, three, four, five, six, seven, eight, nine, ten } = require('./my-utils');
const { one1, two1, three1, four1, five1, six1, seven1, eight1, nine1, ten1, eleven1 } = require('./my-utils');

const MyReallyExtrememlyLongModuleName = require('MyReallyExtrememlyLongModuleName');

const plugin = require(
  global.STANDALONE
    ? path.join(__dirname, "../standalone.js")
    : path.join(__dirname, "..")
);

const plugin2 = require(
  path.join(
    __dirname,
    global.STANDALONE ? "../standalone.js" : '..'
  )
);

const plugin3 = require('./a/long/long/long/long/long/long/long/long/long/long/long/path/to/module')
