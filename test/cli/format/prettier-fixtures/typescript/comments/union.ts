type UploadState<E, EM, D>
  // The upload hasnt begun yet
  = {type: "Not_begun"}
  // The upload timed out
  | {type: "Timed_out"}
  // Failed somewhere on the line
  | {type: "Failed", error: E, errorMsg: EM}
  // Uploading to aws3 and CreatePostMutation succeeded
  | {type: "Success", data: D};

type UploadState2<E, EM, D>
  // The upload hasnt begun yet
  = A
  // The upload timed out
  | B
  // Failed somewhere on the line
  | C
  // Uploading to aws3 and CreatePostMutation succeeded
  | D;
