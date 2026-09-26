// Finds the S3 operation of a request from the method, the resource and the
// query parameters that name a subresource.

import type { RequestContext } from "./context.ts";
import { notImplemented, S3Error } from "./errors.ts";
import * as bucket from "./handlers/bucket.ts";
import * as list from "./handlers/list.ts";
import * as multipart from "./handlers/multipart.ts";
import * as objectConfig from "./handlers/object-config.ts";
import * as object from "./handlers/object.ts";
import { postObject } from "./handlers/post-object.ts";

export type Handler = (context: RequestContext) => Promise<Response>;

export interface Route {
  /** The name of the operation in the S3 API reference. */
  operation: string;
  handler: Handler;
}

type Methods = Partial<Record<"GET" | "HEAD" | "PUT" | "POST" | "DELETE", [operation: string, handler: Handler]>>;

const bucketSubresources: Record<string, Methods> = {
  "location": { GET: ["GetBucketLocation", bucket.getBucketLocation] },
  "versioning": {
    GET: ["GetBucketVersioning", bucket.getBucketVersioning],
    PUT: ["PutBucketVersioning", bucket.putBucketVersioning],
  },
  "tagging": {
    GET: ["GetBucketTagging", bucket.getBucketTagging],
    PUT: ["PutBucketTagging", bucket.putBucketTagging],
    DELETE: ["DeleteBucketTagging", bucket.deleteBucketTagging],
  },
  "cors": {
    GET: ["GetBucketCors", bucket.getBucketCors],
    PUT: ["PutBucketCors", bucket.putBucketCors],
    DELETE: ["DeleteBucketCors", bucket.deleteBucketCors],
  },
  "policy": {
    GET: ["GetBucketPolicy", bucket.getBucketPolicy],
    PUT: ["PutBucketPolicy", bucket.putBucketPolicy],
    DELETE: ["DeleteBucketPolicy", bucket.deleteBucketPolicy],
  },
  "policyStatus": { GET: ["GetBucketPolicyStatus", bucket.getBucketPolicyStatus] },
  "acl": { GET: ["GetBucketAcl", bucket.getBucketAcl], PUT: ["PutBucketAcl", bucket.putBucketAcl] },
  "requestPayment": {
    GET: ["GetBucketRequestPayment", bucket.getBucketRequestPayment],
    PUT: ["PutBucketRequestPayment", bucket.putBucketRequestPayment],
  },
  "ownershipControls": {
    GET: ["GetBucketOwnershipControls", bucket.getBucketOwnershipControls],
    PUT: ["PutBucketOwnershipControls", bucket.putBucketOwnershipControls],
    DELETE: ["DeleteBucketOwnershipControls", bucket.deleteBucketOwnershipControls],
  },
  "object-lock": {
    GET: ["GetObjectLockConfiguration", bucket.getObjectLockConfiguration],
    PUT: ["PutObjectLockConfiguration", bucket.putObjectLockConfiguration],
  },
  "uploads": { GET: ["ListMultipartUploads", multipart.listMultipartUploads] },
  "versions": { GET: ["ListObjectVersions", list.listObjectVersions] },
  "delete": { POST: ["DeleteObjects", object.deleteObjects] },
};

const storedConfigurationNames: Record<string, string> = {
  lifecycle: "BucketLifecycleConfiguration",
  encryption: "BucketEncryption",
  website: "BucketWebsite",
  notification: "BucketNotificationConfiguration",
  logging: "BucketLogging",
  replication: "BucketReplication",
  accelerate: "BucketAccelerateConfiguration",
  publicAccessBlock: "PublicAccessBlock",
};

for (const configuration of bucket.STORED_CONFIGURATIONS) {
  const methods: Methods = {};
  const name = storedConfigurationNames[configuration.subresource];
  for (const [method, verb] of [
    ["GET", "Get"],
    ["PUT", "Put"],
    ["DELETE", "Delete"],
  ] as const) {
    const handler = bucket.storedConfigurationHandler(configuration, method);
    // The API names the delete operation of the lifecycle configuration DeleteBucketLifecycle.
    const operation = verb + (method === "DELETE" ? name.replace(/^BucketLifecycle.*/, "BucketLifecycle") : name);
    if (handler) methods[method] = [operation, handler];
  }
  bucketSubresources[configuration.subresource] = methods;
}

const objectSubresources: Record<string, Methods> = {
  "tagging": {
    GET: ["GetObjectTagging", objectConfig.getObjectTagging],
    PUT: ["PutObjectTagging", objectConfig.putObjectTagging],
    DELETE: ["DeleteObjectTagging", objectConfig.deleteObjectTagging],
  },
  "acl": { GET: ["GetObjectAcl", objectConfig.getObjectAcl], PUT: ["PutObjectAcl", objectConfig.putObjectAcl] },
  "retention": {
    GET: ["GetObjectRetention", objectConfig.getObjectRetention],
    PUT: ["PutObjectRetention", objectConfig.putObjectRetention],
  },
  "legal-hold": {
    GET: ["GetObjectLegalHold", objectConfig.getObjectLegalHold],
    PUT: ["PutObjectLegalHold", objectConfig.putObjectLegalHold],
  },
  "attributes": { GET: ["GetObjectAttributes", object.getObjectAttributes] },
  "restore": { POST: ["RestoreObject", object.restoreObject] },
  "uploads": { POST: ["CreateMultipartUpload", multipart.createMultipartUpload] },
};

/** Subresources of the S3 API that this server does not have. */
const unsupportedSubresources = [
  "abac",
  "analytics",
  "annotation",
  "inventory",
  "metrics",
  "intelligent-tiering",
  "metadataTable",
  "metadataConfiguration",
  "metadataAnnotationTable",
  "metadataInventoryTable",
  "metadataJournalTable",
  "session",
  "torrent",
  "select",
  "renameObject",
];

function methodNotAllowed(context: RequestContext, resourceType: string, allow: string[]): S3Error {
  return new S3Error("MethodNotAllowed", {
    details: { Method: context.method, ResourceType: resourceType },
    headers: { allow: allow.join(", ") },
  });
}

function fromSubresources(
  context: RequestContext,
  table: Record<string, Methods>,
  resourceType: string,
): Route | undefined {
  // A HEAD request reads the bucket or the object. It has no subresources.
  if (context.method === "HEAD") return undefined;
  for (const { name } of context.query.parameters) {
    if (unsupportedSubresources.includes(name)) throw notImplemented(name);
    // The subresource of UpdateObjectEncryption. Without this check the request writes the object.
    if (name === "encryption" && resourceType === "OBJECT") throw notImplemented(name);
    if (!Object.hasOwn(table, name)) continue;
    const methods = table[name];
    const entry = methods[context.method as keyof Methods];
    if (!entry) throw methodNotAllowed(context, resourceType, Object.keys(methods));
    return { operation: entry[0], handler: entry[1] };
  }
  return undefined;
}

export function route(context: RequestContext): Route {
  const { method, query, headers } = context;

  if (method === "OPTIONS" && context.bucketName !== undefined) {
    return { operation: "Preflight", handler: bucket.preflight };
  }

  if (context.bucketName === undefined) {
    if (method === "GET" || method === "HEAD") return { operation: "ListBuckets", handler: bucket.listBuckets };
    throw methodNotAllowed(context, "SERVICE", ["GET"]);
  }

  if (context.key === undefined) {
    const subresource = fromSubresources(context, bucketSubresources, "BUCKET");
    if (subresource) return subresource;
    switch (method) {
      case "GET":
        return query.get("list-type") === "2"
          ? { operation: "ListObjectsV2", handler: list.listObjectsV2 }
          : { operation: "ListObjects", handler: list.listObjects };
      case "HEAD":
        return { operation: "HeadBucket", handler: bucket.headBucket };
      case "PUT":
        return { operation: "CreateBucket", handler: bucket.createBucket };
      case "DELETE":
        return { operation: "DeleteBucket", handler: bucket.deleteBucket };
      case "POST":
        return { operation: "PostObject", handler: postObject };
    }
    throw methodNotAllowed(context, "BUCKET", ["GET", "HEAD", "PUT", "POST", "DELETE"]);
  }

  if (query.has("uploadId")) {
    switch (method) {
      case "GET":
        return { operation: "ListParts", handler: multipart.listParts };
      case "PUT":
        return headers.has("x-amz-copy-source")
          ? { operation: "UploadPartCopy", handler: multipart.uploadPartCopy }
          : { operation: "UploadPart", handler: multipart.uploadPart };
      case "POST":
        return { operation: "CompleteMultipartUpload", handler: multipart.completeMultipartUpload };
      case "DELETE":
        return { operation: "AbortMultipartUpload", handler: multipart.abortMultipartUpload };
    }
    throw methodNotAllowed(context, "OBJECT", ["GET", "PUT", "POST", "DELETE"]);
  }

  const subresource = fromSubresources(context, objectSubresources, "OBJECT");
  if (subresource) return subresource;
  switch (method) {
    case "GET":
      return { operation: "GetObject", handler: object.getObject };
    case "HEAD":
      return { operation: "HeadObject", handler: object.getObject };
    case "PUT":
      return headers.has("x-amz-copy-source")
        ? { operation: "CopyObject", handler: object.copyObject }
        : { operation: "PutObject", handler: object.putObject };
    case "DELETE":
      return { operation: "DeleteObject", handler: object.deleteObject };
  }
  throw methodNotAllowed(context, "OBJECT", ["GET", "HEAD", "PUT", "DELETE"]);
}
