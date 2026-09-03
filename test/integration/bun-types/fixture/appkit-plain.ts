// What bun:objc and bun:appkit type like whether or not the program
// references bun-types/objc-sdk (appkit.ts does; one test replaces it so
// that nothing does): the classes the bridge names have types of their own
// either way, destructure under noUncheckedIndexedAccess, and take any selector.
import { Button, Window } from "bun:appkit";
import { objc, type ObjCClass, type ObjCObject } from "bun:objc";
import { expectType } from "./utilities";

const { NSString, NSMutableArray } = objc.classes;
expectType(NSString).is<objc.classes.NSString>();
expectType(NSMutableArray).is<objc.classes.NSMutableArray>();
expectType(objc.classes.NSRareThing).is<ObjCClass | undefined>();
const greeting: objc.NSString = NSString.stringWithString_("hi");
const upper: ObjCObject = greeting.uppercaseString();
const list: objc.NSMutableArray = NSMutableArray.new();
list.addObject_(upper);
list.anySelectorAtAll_with_(1, "two");

const win = new Window({ title: "plain" });
expectType(win.native).is<objc.NSWindow>();
const content: objc.NSView | null = win.native.contentView();
const control: objc.NSControl = new Button({ title: "b" }).native;
expectType(new Button({ title: "b" }).native).is<objc.NSButton>();

const titled: number = objc.enums.NSWindowStyleMask.titled;
const utf8: number = objc.enums.NSUTF8StringEncoding;
win.native.setStyleMask_(titled | objc.enums.NSWindowStyleMask.closable);
// Functions are callable either way: typed with the reference, `any` without.
objc.functions.NSBeep();
const home: string = String(objc.functions.NSHomeDirectory());
export { content, control, home, list, utf8 };
