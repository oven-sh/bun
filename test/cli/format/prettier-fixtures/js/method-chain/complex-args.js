client.execute(
  Post.selectAll()
    .where(Post.id.eq(42))
    .where(Post.published.eq(true))
);
