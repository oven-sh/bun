interface RelayProps {
  articles: a | null,
}
interface RelayProps {
  articles: Array<{
    __id: string,
  } | null> | null | void,
}

interface RelayProps {
  articles: Array<{
    __id: string,
  } | null>
  | null // articles type may be null
  | void, // articles type may be void
}

type FooBar = null // null
| { /** x **/
  y: number;
  z: string;
} // this documents the first option
  | void // this documents the second option
  ;

type FooBarWithoutComment = null
  | {
  y: number;
  z: string;
}
  | void
  ;

type FooBar2 =
  | Number // this documents the first option
  | void // this documents the second option
  ;

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

type window = Window & {
  __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: Function;
};

type T1 = (number | string)["toString"];
type T2 = ((number | string))["toString"];
type T3 = (((number | string)))["toString"];
type T4 = ((((number | string))))["toString"];
type T5 = number | ((arg: any) => void);
type T6 = number | (((arg: any) => void));
type T7 = number | ((((arg: any) => void)));
type T8 = number | (((((arg: any) => void))));
