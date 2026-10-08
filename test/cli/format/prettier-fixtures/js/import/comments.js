import { a //comment1
//comment2
//comment3
as b} from "";

import {
  a as //comment1
  //comment2
  //comment3
  b1
} from "";

import {
  a as //comment2 //comment1
  //comment3
  b2
} from "";

import {
  a as //comment3 //comment2 //comment1
  b3
} from "";

import {
  // comment 1
  FN1, // comment 2
  /* comment 3 */ FN2,
  // FN3,
  FN4 /* comment 4 */
  // FN4,
  // FN5
} from "./module";

import {
  ExecutionResult,
  DocumentNode,
  /* tslint:disable */
  SelectionSetNode,
  /* tslint:enable */
} from 'graphql';

import x, {
  // comment
  y
} from 'z';
