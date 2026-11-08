// An Amazon S3 compatible server on top of `Bun.serve`, for the tests of Bun.
// It has no dependencies and keeps all data in memory.
//
//   import { serve } from "s3-server";
//
//   await using server = serve({ buckets: ["my-bucket"] });
//   const client = new Bun.S3Client(server.clientOptions("my-bucket"));
//   await client.write("hello.txt", "Hello");
//
// `serve()` runs the server in the process of the test. `spawnServer()` runs
// it in a child process, for a test that moves much data. `S3Server.fetch` is
// the server as a function, for a test that puts its own `Bun.serve` in front
// of it to inject faults. `SigningClient` sends signed requests for the
// operations that `Bun.S3Client` has no method for.
//
// The server verifies AWS Signature Version 4 on each request: the
// `Authorization` header, presigned URLs, and the chunk signatures of
// aws-chunked bodies. It answers with the status codes, headers and XML
// documents of Amazon S3. Where Amazon S3 and MinIO differ, it follows Amazon S3.
//
// Operations:
// - Service: ListBuckets
// - Bucket: CreateBucket, HeadBucket, DeleteBucket, GetBucketLocation,
//   ListObjects, ListObjectsV2, ListObjectVersions, ListMultipartUploads
// - Bucket configuration with an effect: versioning, ACL, policy, CORS,
//   tagging, request payment, ownership controls, public access block,
//   object lock
// - Bucket configuration that the server only keeps and returns: lifecycle,
//   encryption, website, notification, logging, replication, accelerate
// - Object: PutObject, GetObject, HeadObject, DeleteObject, DeleteObjects,
//   CopyObject, PostObject, GetObjectAttributes, RestoreObject, tagging, ACL,
//   retention, legal hold
// - Multipart: CreateMultipartUpload, UploadPart, UploadPartCopy,
//   CompleteMultipartUpload, AbortMultipartUpload, ListParts
// A request for another operation gets the error `NotImplemented`.
//
// Differences from Amazon S3:
// - `Bun.serve` removes `.` and `..` segments from the path of a request
//   before the server sees it. A key that has such a segment cannot be used:
//   the signature of the request does not match.
// - The server stores the bytes of an object as they are. The encryption
//   headers make the round trip, but nothing is encrypted.
// - A restore from an archive storage class completes immediately.
// - A new bucket has ACLs enabled and has no public access block, which was
//   the default of Amazon S3 until April 2023.
// - The server is one endpoint. A bucket in another region than the server
//   gets `PermanentRedirect`, and no endpoint serves it.
// - The server does not run lifecycle rules, replication, notifications or
//   website hosting, and it has no Signature Version 2 and no Signature
//   Version 4A.

export { SigningClient, encodeAwsChunked } from "./src/client.ts";
export type { PayloadSigning, RequestOptions, SignedRequest, SigningClientOptions } from "./src/client.ts";
export { S3Error } from "./src/errors.ts";
export type { S3ErrorCode } from "./src/errors.ts";
export { DEFAULT_CREDENTIALS, DEFAULT_OWNER, S3Server, serve } from "./src/server.ts";
export type { BucketOptions, CredentialOptions, RequestRecord, S3ServerOptions } from "./src/server.ts";
export type { Credential, Owner } from "./src/signature.ts";
export { spawnServer } from "./src/spawn.ts";
export type { SpawnedServer, SpawnOptions } from "./src/spawn.ts";
export { Bucket, ObjectData } from "./src/store.ts";
export type { MultipartUpload, ObjectVersion, Tag } from "./src/store.ts";
