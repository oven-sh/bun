//https://github.com/prettier/prettier/issues/3002
beep.boop().baz("foo",
{
  some: {
    thing: {
      nested: true
    }
  }
},
{ another: { thing: true } },
() => {});


//https://github.com/prettier/prettier/issues/2984
db.collection('indexOptionDefault').createIndex({ a: 1 }, {
  indexOptionDefaults: true,
  w: 2,
  wtimeout: 1000
}, function(err) {
  test.equal(null, err);
  test.deepEqual({ w: 2, wtimeout: 1000 }, commandResult.writeConcern);

  client.close();
  done();
});