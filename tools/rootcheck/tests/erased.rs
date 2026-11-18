//! Ways to get rid of the type that gives the memory away.

#![forbid(unsafe_code)]

use std::any::Any;
use std::mem::ManuallyDrop;
use std::rc::Rc;

use bun_engine_vm::heap::root_box;
use bun_engine_vm::*;

pub fn boxed_closure(value: Value) -> Box<dyn Fn() -> Value> {
    Box::new(move || value) //~ hidden: made a trait object here
}

pub fn boxed_closure_that_borrows<'a>(object: &'a JsObject) -> Box<dyn Fn() -> bool + 'a> {
    Box::new(move || object.is_string()) //~ hidden: made a trait object here
}

pub fn boxed_closure_with_a_realm<'a>(cx: &'a mut Cx) -> Box<dyn FnMut() -> bool + 'a> {
    Box::new(move || cx.new_object().is_string()) //~ hidden: made a trait object here
}

pub fn boxed_iterator(object: Gc<JsObject>) -> Box<dyn Iterator<Item = Gc<JsObject>>> {
    Box::new(std::iter::once(object)) //~ hidden: made a trait object here
}

pub fn any(value: Value) -> Rc<dyn Any> {
    Rc::new(value) //~ hidden: made a trait object here
}

pub fn root_box_of_what_hides(value: Value) -> bun_engine_vm::heap::RootBox<dyn Any> {
    root_box(vec![value]) //~ hidden: made a trait object here
}

pub fn leaked_box(value: Value) -> &'static mut Value {
    Box::leak(Box::new(value)) //~ hidden: taken apart or leaked here
}

pub fn leaked_empty_list() -> &'static mut Vec<Value> {
    Box::leak(Box::default()) //~ hidden: taken apart or leaked here
}

pub fn leaked_list(value: Value) -> &'static mut [Value] {
    vec![value].leak() //~ hidden: taken apart or leaked here
}

pub fn raw(value: Value) -> *mut Value {
    Box::into_raw(Box::new(value)) //~ hidden: taken apart or leaked here
}

pub trait Describe {
    fn describe(&self) {}
}

impl Describe for JsObject {}
impl Describe for Gc<JsObject> {}

pub fn reference_to_a_cell(object: Gc<JsObject>) {
    let through_the_stack: &dyn Describe = &object;
    let direct: &dyn Describe = &*object; //~ erased: does not tell that it refers to a cell
}

pub fn guard_that_is_never_dropped(cx: &Cx, string: &JsString) -> JsResult<usize> {
    let view = ManuallyDrop::new(string.view(cx)?); //~ guard: only if it is dropped
    Ok(view.text().len())
}

pub extern "C" fn to_foreign_code(value: Value) -> Box<Value> { //~ hidden: returned to foreign code
    Box::new(value)
}

pub fn boxed_future(value: Value) -> std::pin::Pin<Box<dyn Future<Output = Value>>> {
    Box::pin(async move { value }) //~ hidden: made a trait object here
}

#[derive(Debug)]
pub struct Failure(Gc<JsObject>);

impl std::fmt::Display for Failure {
    fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        Ok(())
    }
}

impl std::error::Error for Failure {}

pub fn by_the_standard_library(failure: Result<(), Failure>) -> Result<(), Box<dyn std::error::Error>> {
    Ok(failure?) //~ hidden: which this leads to
}
