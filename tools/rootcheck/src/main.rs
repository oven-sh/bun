//! A compiler driver that finds references to cells where the engine's collector does not look. See README.md.

#![feature(rustc_private)]

extern crate rustc_abi;
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_borrowck;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_hir;
extern crate rustc_index;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_middle;
extern crate rustc_mir_dataflow;
extern crate rustc_mir_transform;
extern crate rustc_span;
extern crate rustc_trait_selection;

mod allow;
mod bodies;
mod borrows;
mod calls;
mod engine;
mod items;
mod types;

use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def_id::LocalDefId;
use rustc_interface::interface::{Compiler, Config};
use rustc_middle::ty::TyCtxt;
use rustc_mir_transform::run_analysis_to_runtime_passes;
use rustc_span::{ErrorGuaranteed, Symbol};

use crate::engine::Engine;

const LIST_LENDERS: &str = "ROOTCHECK_LENDERS";

struct Rootcheck;

impl Callbacks for Rootcheck {
    /// These work on a copy, so that the borrow checker can be asked again afterwards.
    fn config(&mut self, config: &mut Config) {
        config.override_queries = Some(|_, providers| {
            providers.queries.mir_drops_elaborated_and_const_checked = |tcx, def_id| {
                if tcx.is_coroutine(def_id.to_def_id()) {
                    tcx.ensure_done().mir_coroutine_witnesses(def_id);
                }
                let mut body = tcx.mir_promoted(def_id).0.borrow().clone();
                body.tainted_by_errors = body.tainted_by_errors.or(borrow_check(tcx, def_id));
                run_analysis_to_runtime_passes(tcx, &mut body);
                tcx.alloc_steal_mir(body)
            };
            providers.queries.promoted_mir = |tcx, def_id| {
                if tcx.is_constructor(def_id.to_def_id()) {
                    return tcx.arena.alloc(Default::default());
                }
                borrow_check(tcx, def_id);
                let mut bodies = tcx.mir_promoted(def_id).1.borrow().clone();
                bodies.iter_mut().for_each(|body| run_analysis_to_runtime_passes(tcx, body));
                tcx.arena.alloc(bodies)
            };
        });
    }

    /// Has cargo check the crate again when this program changes.
    fn after_expansion<'tcx>(&mut self, _: &Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        if Engine::is_visible(tcx) {
            let program = std::env::current_exe().expect("a path to this program");
            let program = Symbol::intern(&program.to_string_lossy());
            tcx.sess.file_depinfo.borrow_mut().insert(program);
            let value = std::env::var(LIST_LENDERS).ok().map(|it| Symbol::intern(&it));
            tcx.sess.env_depinfo.borrow_mut().insert((Symbol::intern(LIST_LENDERS), value));
        }
        Compilation::Continue
    }

    fn after_analysis<'tcx>(&mut self, _: &Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        if let Some(engine) = Engine::find(tcx) {
            let cx = types::Types::new(tcx, engine);
            items::check(&cx);
            if std::env::var_os(LIST_LENDERS).is_some() {
                borrows::list_lenders(&cx);
            }
            let calls = calls::Calls::new(&cx);
            let instantiations = calls::check(&calls, &cx);
            items::check_visited(&cx, &calls);
            let trusting = calls::Calls::going_by_signatures(&cx);
            calls::check_signatures(&trusting, &instantiations);
            borrows::check(&cx, &calls, &trusting, &instantiations);
            allow::check(&cx);
        }
        Compilation::Continue
    }
}

fn borrow_check(tcx: TyCtxt<'_>, def_id: LocalDefId) -> Option<ErrorGuaranteed> {
    let root = tcx.typeck_root_def_id_local(def_id);
    (!tcx.is_synthetic_mir(def_id)).then(|| tcx.mir_borrowck(root).err()).flatten()
}

fn main() -> ExitCode {
    // Cargo passes the path of the compiler first, which takes the place of the name of the program.
    let mut arguments: Vec<String> = std::env::args().skip(1).collect();
    arguments.extend(
        [
            "--cfg=rootcheck",
            "--check-cfg=cfg(rootcheck)",
            "-Zcrate-attr=feature(register_tool)",
            "-Zcrate-attr=register_tool(rootcheck)",
            "-Zalways-encode-mir",
            "-Zmir-opt-level=0",
        ]
        .map(String::from),
    );
    rustc_driver::install_ice_hook("tools/rootcheck", |_| ());
    rustc_driver::catch_with_exit_code(|| {
        rustc_driver::compiler_entrypoint(&arguments, &mut Rootcheck)
    })
}
