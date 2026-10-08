const writer = new BufferStackItem(
  new BinaryWriter()
    .writeUInt8(StackItemType.ByteArray)
    .writeVarBytesLE(Buffer.alloc(10, 1))
    .toBuffer(),
);

const writer2 = new BufferStackItem(
  new Extra.BinaryWriter()
    .writeUInt8(StackItemType.ByteArray)
    .writeVarBytesLE(Buffer.alloc(10, 1))
    .toBuffer(),
);
