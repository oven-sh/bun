// The S3 error codes this server can return, with the HTTP status and the
// default message that Amazon S3 sends for each one.
const errors = {
  AccessControlListNotSupported: [400, "The bucket does not allow ACLs"],
  AccessDenied: [403, "Access Denied"],
  AccessForbidden: [403, "CORSResponse: CORS is not enabled for this bucket."],
  AuthorizationHeaderMalformed: [400, "The authorization header that you provided is not valid."],
  AuthorizationQueryParametersError: [
    400,
    "Query-string authentication version 4 requires the X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, X-Amz-Date, X-Amz-SignedHeaders, and X-Amz-Expires parameters.",
  ],
  BadDigest: [400, "The Content-MD5 you specified did not match what we received."],
  BadRequest: [400, "Bad Request"],
  BucketAlreadyExists: [
    409,
    "The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.",
  ],
  BucketAlreadyOwnedByYou: [409, "Your previous request to create the named bucket succeeded and you already own it."],
  BucketNotEmpty: [409, "The bucket you tried to delete is not empty"],
  ConditionalRequestConflict: [
    409,
    "A conflicting conditional operation is currently in progress against this resource. Please try again.",
  ],
  EntityTooLarge: [400, "Your proposed upload exceeds the maximum allowed size"],
  EntityTooSmall: [400, "Your proposed upload is smaller than the minimum allowed size"],
  ExpiredToken: [400, "The provided token has expired."],
  IllegalLocationConstraintException: [
    400,
    "The unspecified location constraint is incompatible for the region specific endpoint this request was sent to.",
  ],
  IllegalVersioningConfigurationException: [
    400,
    "Indicates that the versioning configuration specified in the request is invalid.",
  ],
  IncompleteBody: [400, "You did not provide the number of bytes specified by the Content-Length HTTP header"],
  InternalError: [500, "We encountered an internal error. Please try again."],
  InvalidAccessKeyId: [403, "The AWS Access Key Id you provided does not exist in our records."],
  InvalidArgument: [400, "Invalid Argument"],
  InvalidBucketAclWithObjectOwnership: [
    400,
    "Bucket cannot have ACLs set with ObjectOwnership's BucketOwnerEnforced setting",
  ],
  InvalidBucketName: [400, "The specified bucket is not valid."],
  InvalidBucketState: [409, "The request is not valid with the current state of the bucket."],
  InvalidChunkSizeError: [403, "Only the last chunk is allowed to have a size less than 8192 bytes"],
  InvalidDigest: [400, "The Content-MD5 you specified was invalid."],
  InvalidEncryptionAlgorithmError: [
    400,
    "The encryption request you specified is not valid. The valid value is AES256.",
  ],
  InvalidLocationConstraint: [400, "The specified location-constraint is not valid"],
  InvalidObjectState: [403, "The operation is not valid for the object's storage class"],
  InvalidPart: [
    400,
    "One or more of the specified parts could not be found.  The part may not have been uploaded, or the specified entity tag may not match the part's entity tag.",
  ],
  InvalidPartNumber: [416, "The requested partnumber is not satisfiable"],
  InvalidPartOrder: [400, "The list of parts was not in ascending order. Parts must be ordered by part number."],
  InvalidPolicyDocument: [
    400,
    "The content of the form does not meet the conditions specified in the policy document.",
  ],
  InvalidRange: [416, "The requested range is not satisfiable"],
  InvalidRequest: [400, "Invalid Request"],
  InvalidStorageClass: [400, "The storage class you specified is not valid"],
  InvalidTag: [
    400,
    "The tag provided was not a valid tag. This error can occur if the tag did not pass input validation.",
  ],
  InvalidToken: [400, "The provided token is malformed or otherwise invalid."],
  InvalidURI: [400, "Couldn't parse the specified URI."],
  KeyTooLongError: [400, "Your key is too long"],
  MalformedACLError: [400, "The XML you provided was not well-formed or did not validate against our published schema"],
  MalformedPOSTRequest: [400, "The body of your POST request is not well-formed multipart/form-data."],
  MalformedPolicy: [400, "Policies must be valid JSON and the first byte must be '{'"],
  MalformedTrailerError: [
    400,
    "The request contained trailing data that was not well-formed or did not conform to our published schema.",
  ],
  MalformedXML: [400, "The XML you provided was not well-formed or did not validate against our published schema"],
  MaxMessageLengthExceeded: [400, "Your request was too big."],
  MaxPostPreDataLengthExceededError: [400, "Your POST request fields preceding the upload file were too large."],
  MetadataTooLarge: [400, "Your metadata headers exceed the maximum allowed metadata size"],
  MethodNotAllowed: [405, "The specified method is not allowed against this resource."],
  MissingContentLength: [411, "You must provide the Content-Length HTTP header."],
  MissingRequestBodyError: [400, "Request body is empty."],
  MissingSecurityHeader: [400, "Your request is missing a required header."],
  NoSuchBucket: [404, "The specified bucket does not exist"],
  NoSuchBucketPolicy: [404, "The bucket policy does not exist"],
  NoSuchCORSConfiguration: [404, "The CORS configuration does not exist"],
  NoSuchKey: [404, "The specified key does not exist."],
  NoSuchLifecycleConfiguration: [404, "The lifecycle configuration does not exist"],
  NoSuchObjectLockConfiguration: [404, "The specified object does not have a ObjectLock configuration"],
  NoSuchPublicAccessBlockConfiguration: [404, "The public access block configuration was not found"],
  NoSuchTagSet: [404, "The TagSet does not exist"],
  NoSuchUpload: [
    404,
    "The specified upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.",
  ],
  NoSuchVersion: [404, "The specified version does not exist."],
  NoSuchWebsiteConfiguration: [404, "The specified bucket does not have a website configuration"],
  NotImplemented: [501, "A header you provided implies functionality that is not implemented"],
  ObjectLockConfigurationNotFoundError: [404, "Object Lock configuration does not exist for this bucket"],
  OwnershipControlsNotFoundError: [404, "The bucket ownership controls were not found"],
  PreconditionFailed: [412, "At least one of the pre-conditions you specified did not hold"],
  ReplicationConfigurationNotFoundError: [404, "The replication configuration was not found"],
  RequestTimeTooSkewed: [403, "The difference between the request time and the current time is too large."],
  RestoreAlreadyInProgress: [409, "Object restore is already in progress"],
  ServerSideEncryptionConfigurationNotFoundError: [404, "The server side encryption configuration was not found"],
  SignatureDoesNotMatch: [
    403,
    "The request signature we calculated does not match the signature you provided. Check your key and signing method.",
  ],
  TooManyBuckets: [400, "You have attempted to create more buckets than allowed"],
  UnexpectedContent: [400, "This request does not support content"],
  XAmzContentSHA256Mismatch: [400, "The provided 'x-amz-content-sha256' header does not match what was computed."],
} as const satisfies Record<string, readonly [status: number, message: string]>;

export type S3ErrorCode = keyof typeof errors;

/** Extra elements of the `<Error>` document, in the order they are written. */
export type S3ErrorDetails = Record<string, string | number | undefined>;

/**
 * An error that the server sends to the client as an S3 `<Error>` document.
 * Handlers throw it. The server turns it into the HTTP response.
 */
export class S3Error extends Error {
  override name = "S3Error";
  readonly code: S3ErrorCode;
  readonly status: number;
  readonly details: S3ErrorDetails;
  /** Response headers that go with the error, for example `Allow` or `x-amz-delete-marker`. */
  readonly headers: Record<string, string>;

  constructor(
    code: S3ErrorCode,
    options: { message?: string; details?: S3ErrorDetails; headers?: Record<string, string> } = {},
  ) {
    const [status, message] = errors[code];
    super(options.message ?? message);
    this.code = code;
    this.status = status;
    this.details = options.details ?? {};
    this.headers = options.headers ?? {};
  }
}

export function invalidArgument(message: string, name: string, value: string | number | undefined): S3Error {
  return new S3Error("InvalidArgument", {
    message,
    details: { ArgumentName: name, ArgumentValue: value === undefined ? "" : String(value) },
  });
}

export function invalidRequest(message: string): S3Error {
  return new S3Error("InvalidRequest", { message });
}

export function notImplemented(header: string, message?: string): S3Error {
  return new S3Error("NotImplemented", { message, details: { Header: header } });
}

export function malformedXml(): S3Error {
  return new S3Error("MalformedXML");
}
