import { groupsOfPlaces, placeKinds, type Place, type Table, type TableDoor } from "../../scripts/build/islands-layout.ts";

function refuse(why: string): never {
  throw new Error(`refused: ${why}`);
}

const hex = (value: number) => "0x" + value.toString(16);
const signExtended = (field: number, bits: number) => (field << (32 - bits)) >> (32 - bits);

function asField(value: number, bits: number): number {
  if (!Number.isInteger(value) || value < -(2 ** (bits - 1)) || value >= 2 ** (bits - 1)) refuse(`${value} does not fit ${bits} bits`);
  return (value & (2 ** bits - 1)) >>> 0;
}

const immediate21 = (word: number) => signExtended((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);

function withImmediate21(word: number, immediate: number): number {
  const field = asField(immediate, 21);
  return ((word & 0x9f00001f) | ((field & 3) << 29) | ((field >>> 2) << 5)) >>> 0;
}

export function unrelax(file: Buffer, offsets: [number, number], places: Place[], door: number, stub: number): void {
  const adr = places[0]!.kind === placeKinds.adr ? 0 : 1;
  const word = file.readUInt32LE(offsets[adr]!);
  if ((word & 0x9f000000) >>> 0 !== 0x10000000) refuse(`${hex(word)} at ${hex(places[adr]!.address)} is no adr`);
  if (places[adr]!.address + immediate21(word) !== door) refuse(`the adr at ${hex(places[adr]!.address)} does not point at ${hex(door)}`);
  if (file.readUInt32LE(offsets[1 - adr]!) !== 0xd503201f) refuse(`there is no nop at ${hex(places[1 - adr]!.address)}`);
  const register = word & 31;
  file.writeUInt32LE(withImmediate21(0x90000000 + register, Math.floor(stub / 4096) - Math.floor(places[0]!.address / 4096)), offsets[0]);
  file.writeUInt32LE((0x91000000 | ((stub % 4096) << 10) | (register << 5) | register) >>> 0, offsets[1]);
}

export function redirect(file: Buffer, offset: number, place: Place, door: number, stub: number): void {
  const delta = stub - door;
  const distanceTo = (target: number) => target - place.address;
  const pagesTo = (target: number) => Math.floor(target / 4096) - Math.floor(place.address / 4096);
  const instruction = (mask: number, opcode: number) => {
    const word = file.readUInt32LE(offset);
    if ((word & mask) >>> 0 !== opcode) refuse(`${hex(word)} at ${hex(place.address)} is not the instruction of kind ${place.kind}`);
    return word;
  };
  const pointsAtTheDoor = (holds: boolean) => holds || refuse(`the field at ${hex(place.address)} does not point at ${hex(door)}`);
  const write = (word: number) => void file.writeUInt32LE(word >>> 0, offset);
  switch (place.kind) {
    case placeKinds.add32: {
      const value = file.readInt32LE(offset) + delta;
      if (value < -(2 ** 31) || value >= 2 ** 31) refuse(`${value} does not fit 32 bits`);
      file.writeInt32LE(value, offset);
      return;
    }
    case placeKinds.add64: {
      const value = file.readBigUInt64LE(offset) + BigInt(delta);
      if (value < 0n || value >= 1n << 64n) refuse(`${value} does not fit 64 bits`);
      file.writeBigUInt64LE(value, offset);
      return;
    }
    case placeKinds.pointer36: {
      const value = file.readBigUInt64LE(offset);
      const target = (value & 0xfffffffffn) + BigInt(delta);
      if (value >> 63n !== 0n) refuse(`the pointer at ${hex(place.address)} is bound by name`);
      if (target < 0n || target > 0xfffffffffn) refuse(`${target} does not fit 36 bits`);
      file.writeBigUInt64LE((value & ~0xfffffffffn) | target, offset);
      return;
    }
    case placeKinds.branch26: {
      const word = instruction(0x7c000000, 0x14000000);
      pointsAtTheDoor(signExtended(word, 26) * 4 === distanceTo(door));
      return write((word & 0xfc000000) | asField(distanceTo(stub) / 4, 26));
    }
    case placeKinds.page21: {
      const word = instruction(0x9f000000, 0x90000000);
      pointsAtTheDoor(immediate21(word) === pagesTo(door));
      return write(withImmediate21(word, pagesTo(stub)));
    }
    case placeKinds.low12: {
      const word = instruction(0xffc00000, 0x91000000);
      pointsAtTheDoor(((word >>> 10) & 0xfff) === door % 4096);
      return write((word & 0xffc003ff) | ((stub % 4096) << 10));
    }
    default:
      refuse(`no place is of the kind ${place.kind}`);
  }
}

function segmentsOfElf(file: Buffer) {
  const firstHeader = Number(file.readBigUInt64LE(0x20));
  return Array.from({ length: file.readUInt16LE(0x38) }, (_, index) => firstHeader + index * file.readUInt16LE(0x36))
    .filter(at => file.readUInt32LE(at) === 1)
    .map(at => ({
      isCode: (file.readUInt32LE(at + 4) & 1) !== 0,
      hasFixups: false,
      offset: Number(file.readBigUInt64LE(at + 8)),
      address: Number(file.readBigUInt64LE(at + 16)),
      size: Number(file.readBigUInt64LE(at + 32)),
    }));
}

function segmentsOfMachO(file: Buffer) {
  const commands: number[] = [];
  for (let at = 32; commands.length < file.readUInt32LE(16); at += file.readUInt32LE(at + 4)) commands.push(at);
  return commands
    .filter(at => file.readUInt32LE(at) === 0x19)
    .map(at => ({
      isCode: (file.readUInt32LE(at + 60) & 4) !== 0,
      hasFixups: file.toString("latin1", at + 8, at + 24).replace(/\0.*$/, "") !== "__TEXT",
      offset: Number(file.readBigUInt64LE(at + 40)),
      address: Number(file.readBigUInt64LE(at + 24)),
      size: Number(file.readBigUInt64LE(at + 48)),
    }));
}

export function shutDoors(file: Buffer, table: Table, excluded: string[], isArm64: boolean, removedByName: string[] = []): Buffer {
  const out = Buffer.from(file);
  for (const feature of excluded) if (!table.features.includes(feature)) refuse(`there is no feature ${feature}`);
  const segments = out.readUInt32LE(0) === 0xfeedfacf ? segmentsOfMachO(out) : segmentsOfElf(out);
  const segmentOf = (address: number) =>
    segments.find(segment => address >= segment.address && address - segment.address < segment.size) ?? refuse(`nothing in the file is loaded at ${hex(address)}`);
  const offsetOf = (address: number) => segmentOf(address).offset + address - segmentOf(address).address;

  const dead: { start: number; end: number }[] = [];
  for (const { start, end, features } of [...table.islands].sort((a, b) => a.start - b.start)) {
    if (!features.split(",").every(feature => excluded.includes(feature))) continue;
    const last = dead.at(-1);
    if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
    else dead.push({ start, end });
  }
  const isDead = (address: number) => dead.some(({ start, end }) => start <= address && address < end);
  const trap = isArm64 ? [0x20, 0x00, 0x20, 0xd4] : [0xcc];
  for (const { start, end } of dead) if (!segmentOf(start).hasFixups) out.fill(Buffer.from(trap), offsetOf(start), offsetOf(start) + end - start);

  const stubSize = (door: TableDoor) => (isArm64 ? (door.whenShut === "exit" ? 12 : 8) : door.whenShut === "exit" ? 10 : 3);
  const layStub = (at: number, number: number, door: TableDoor) => {
    const isRemovedByName = removedByName.includes(door.feature.split(",", 1)[0]!);
    if (isRemovedByName && door.answers === "undefined") return void Buffer.from(isArm64 ? [0x40, 0x01, 0x80, 0xd2, 0xc0, 0x03, 0x5f, 0xd6] : [0xb8, 0x0a, 0, 0, 0, 0xc3]).copy(out, offsetOf(at));
    const answers = door.answers === "throw" ? 2 ** 30 : door.answers === "undefined" ? 2 ** 31 : 0;
    const doorAndFeature = table.features.indexOf(door.feature.split(",", 1)[0]!) + (isRemovedByName ? 2048 : 0) + number * 4096 + answers;
    const code = Buffer.alloc(stubSize(door));
    if (isArm64 && door.whenShut === "exit") {
      code.writeUInt32LE((0x52800000 | ((doorAndFeature & 0xffff) << 5)) >>> 0, 0);
      code.writeUInt32LE((0x72a00000 | ((doorAndFeature >>> 16) << 5)) >>> 0, 4);
      code.writeUInt32LE((0x14000000 | asField(Math.trunc((table.stub - (at + 8)) / 4), 26)) >>> 0, 8);
    } else if (isArm64) {
      code.writeUInt32LE(0x52800000, 0);
      code.writeUInt32LE(0xd65f03c0, 4);
    } else if (door.whenShut === "exit") {
      code[0] = 0xbf;
      code.writeUInt32LE(doorAndFeature, 1);
      code[5] = 0xe9;
      code.writeInt32LE(table.stub - (at + 10), 6);
    } else code.set([0x31, 0xc0, 0xc3]);
    code.copy(out, offsetOf(at));
  };

  const shut = table.doors.map((door, number) => ({ door, number })).filter(({ door }) => door.feature.split(",").every(feature => excluded.includes(feature)));
  const thin = shut.filter(({ door }) => door.places?.length);
  const exitStubs = thin.filter(({ door }) => door.whenShut === "exit").reduce((sum, { door }) => sum + stubSize(door), 0);
  const returnStub = thin.find(({ door }) => door.whenShut === "return");
  const length = exitStubs + (returnStub === undefined ? 0 : stubSize(returnStub.door));
  if (length > 0) {
    const aligned = dead.map(({ start, end }) => ({ start: Math.ceil(start / 4) * 4, end }));
    const isCode = (start: number, end: number) => segmentOf(start).isCode && end - segmentOf(start).address <= segmentOf(start).size;
    const oneForAll = aligned.find(({ start, end }) => start + length <= end && isCode(start, start + length));
    const rooms = oneForAll !== undefined ? [oneForAll] : aligned.filter(({ start, end }) => start < end && isCode(start, end));
    const lay = (size: number) => {
      while (rooms.length > 0 && rooms[0]!.end - rooms[0]!.start < size) rooms.shift();
      if (rooms.length === 0) refuse(`no dead code holds a strip of ${length} bytes`);
      return (rooms[0]!.start += size) - size;
    };
    const exitStubsAt = thin.filter(({ door }) => door.whenShut === "exit").map(({ door }) => lay(stubSize(door)));
    const returnStubAt = returnStub === undefined ? 0 : lay(stubSize(returnStub.door));
    for (const { door, number } of thin) {
      const at = door.whenShut === "exit" ? exitStubsAt.shift()! : returnStubAt;
      layStub(at, number, door);
      for (const [place, later] of groupsOfPlaces(door.places!) ?? refuse("an adr has no nop beside it")) {
        if (isDead(place!.address)) continue;
        if (later === undefined) redirect(out, offsetOf(place!.address), place!, door.address, at);
        else unrelax(out, [offsetOf(place!.address), offsetOf(later.address)], [place!, later], door.address, at);
      }
    }
  }
  for (const { door, number } of shut) {
    if (door.places?.length || isDead(door.address)) continue;
    if (stubSize(door) > table.smallestDoor[door.whenShut]) refuse(`the door at ${hex(door.address)} may be too small for its stub`);
    layStub(door.address, number, door);
  }
  return out;
}
