import type * as grpc from '../../src/index';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { TestServiceClient as _TestServiceClient, TestServiceDefinition as _TestServiceDefinition } from './TestService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  Request: MessageTypeDefinition
  Response: MessageTypeDefinition
  TestService: SubtypeConstructor<typeof grpc.Client, _TestServiceClient> & { service: _TestServiceDefinition }
}

