pub static SITE: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);
pub static BY_SITE: [core::sync::atomic::AtomicUsize; 3] = [const { core::sync::atomic::AtomicUsize::new(0) }; 3];
pub static BREAK: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
