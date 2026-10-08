MongoClient.connect(
  "mongodb://localhost:27017/posts",
  (err, db) => {
    assert.equal(null, err);
    db.close();
  }
);
