import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { Request as _Request, Request__Output as _Request__Output } from './Request';
import type { Response as _Response, Response__Output as _Response__Output } from './Response';
import type { TestServiceClient as _TestServiceClient, TestServiceDefinition as _TestServiceDefinition } from './TestService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  Request: MessageTypeDefinition<_Request, _Request__Output>
  Response: MessageTypeDefinition<_Response, _Response__Output>
  TestService: SubtypeConstructor<typeof grpc.Client, _TestServiceClient> & { service: _TestServiceDefinition }
}

