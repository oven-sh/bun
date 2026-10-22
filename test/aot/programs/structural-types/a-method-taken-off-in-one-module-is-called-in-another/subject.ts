export class Subject {
  count: number = 10;
  label: string = "subject";
  readCount(): number {
    return this.count;
  }
  labelLength(): number {
    return this.label.length;
  }
  bump(): number {
    return ++this.count;
  }
}

export const shared = new Subject();
export const readShared = shared.readCount;
export const { labelLength, bump } = shared;
export default shared.readCount;
