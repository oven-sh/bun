import { S3Client, s3, randomUUIDv7 } from "bun";
import { expect } from "bun:test";
{
  // custom client
  const s3Client = new S3Client({
    sessionToken: null,
  });
  const filename = randomUUIDv7().replaceAll("-", "");

  const s3file = s3Client.file(filename);
  await s3file.write("content");
  expect(s3file.text()).toBe("content");
  await s3file.unlink();
}

{
  // default client
  const filename = randomUUIDv7().replaceAll("-", "");

  const s3file = await s3.file(filename, {
    sessionToken: null,
  });

  await s3file.write("content");
  expect(s3file.text()).toBe("content");
  await s3file.unlink();
}

{
  // default client but in the methods
  const filename = randomUUIDv7().replaceAll("-", "");

  const s3file = await s3.file(filename);

  await s3file.write("content", {
    sessionToken: null,
  });

  expect(
    s3file.text({
      sessionToken: null,
    }),
  ).toBe("content");
  await s3file.unlink({
    sessionToken: null,
  });
}

{
  // static methods
  const filename = randomUUIDv7().replaceAll("-", "");

  await S3Client.write(filename, "content", {
    sessionToken: null,
  });
  expect(
    await S3Client.file(filename, {
      sessionToken: null,
    }).text(),
  ).toBe("content");
  await S3Client.unlink(filename, {
    sessionToken: null,
  });
}
