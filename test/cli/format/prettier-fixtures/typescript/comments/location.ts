function x({
  x,
  y,
}: {
  // Hello world.
  x: string,
  // Yoyo.
  y: string,
}) {}

export interface ApplicationEventData {
  registerBroadcastReceiver(onReceiveCallback: (
    context: any /* android.content.Context */,
    intent: any /* android.content.Intent */
  ) => void): void;
}

export type WrappedFormUtils = {
  getFieldDecorator(id: string, options?: {
    /** 子节点的值的属性，如 Checkbox 的是 'checked' */
    valuePropName?: string;
    /** 子节点的初始值，类型、可选值均由子节点决定 */
    initialValue?: any;
    /** 收集子节点的值的时机 */
    trigger?: string;
    /** 可以把 onChange 的参数转化为控件的值，例如 DatePicker 可设为：(date, dateString) => dateString */
    getValueFromEvent?: (...args: any[]) => any;
    /** 校验子节点值的时机 */
    validateTrigger?: string | string[];
    /** 校验规则，参见 [async-validator](https://github.com/yiminghe/async-validator) */
    rules?: ValidationRule[];
    /** 是否和其他控件互斥，特别用于 Radio 单选控件 */
    exclusive?: boolean;
  }): (node: React.ReactNode) => React.ReactNode;
};
