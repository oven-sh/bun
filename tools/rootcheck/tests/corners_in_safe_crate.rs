//! What counts as a glance.

#![forbid(unsafe_code)]

use bun_engine_vm::*;

pub fn inherent(list: Vec<Value>) -> usize {
    list.len()
}

pub fn of_a_trait(rest: std::vec::IntoIter<Value>) -> usize { //~ hidden: borrowed here
    ExactSizeIterator::len(&rest)
}

pub struct Holder<T>(Vec<T>);

impl<T> Holder<T> {
    fn count(&self) -> usize {
        self.0.len()
    }
}

pub fn of_ours(holder: Holder<Value>) -> usize { //~ hidden: borrowed here
    holder.count()
}
