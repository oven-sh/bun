//! The items of `bun_engine_vm` that the rules are about.

use rustc_data_structures::fx::FxHashSet;
use rustc_hir::def::Res;
use rustc_hir::def_id::{CRATE_DEF_INDEX, CrateNum, DefId, LOCAL_CRATE};
use rustc_middle::ty::TyCtxt;
use rustc_span::Symbol;

pub struct Engine {
    pub gc_free: DefId,
    pub trace: DefId,
    pub cell_kind: DefId,
    pub service: DefId,
    pub gc: DefId,
    pub owned: DefId,
    pub no_gc: DefId,
    pub gc_ref_mut: DefId,
    pub call_frame: DefId,
    pub ref_cell_guards: [Option<DefId>; 2],
    /// `Cell` and `RefCell`
    pub lend_nothing: [Option<DefId>; 3],
    pub root_alloc: DefId,
    pub defer_collection: DefId,
    /// Whoever has one of these can allocate.
    pub capabilities: [DefId; 3],
    /// What `format_args!` makes, and `fmt::Formatter`.
    pub formatting: [Option<DefId>; 3],
    /// Whoever is given one of these runs inside a collection, where no other starts.
    pub collector_parts: [DefId; 3],
    /// Every collection goes through it.
    pub collect: DefId,
    /// `bun_engine_vm` and the crates that may depend on it.
    upper_crates: FxHashSet<CrateNum>,
    workspace_crates: FxHashSet<CrateNum>,
}

const VM: &str = "bun_engine_vm";

impl Engine {
    pub fn is_visible(tcx: TyCtxt<'_>) -> bool {
        let mut crates = tcx.crates(()).iter().chain([&LOCAL_CRATE]);
        crates.any(|&it| tcx.crate_name(it).as_str() == VM)
    }

    /// `None` in a crate that does not depend on `bun_engine_vm`.
    pub fn find(tcx: TyCtxt<'_>) -> Option<Engine> {
        let crates: Vec<CrateNum> =
            (tcx.postorder_cnums(()).iter().copied()).chain([LOCAL_CRATE]).collect();
        let position = crates.iter().position(|&it| tcx.crate_name(it).as_str() == VM)?;
        let vm = crates[position];
        let in_workspace = |krate: &CrateNum| {
            *krate == LOCAL_CRATE || tcx.crate_name(*krate).as_str().starts_with("bun_")
        };
        let missing = |name: &str| -> ! {
            tcx.dcx().fatal(format!(
                "rootcheck: cannot find `{name}`; update tools/rootcheck/src/engine.rs"
            ))
        };
        let find_trait = |name: &str| {
            let found = tcx.traits(vm).iter().find(|&&it| tcx.item_name(it).as_str() == name);
            found.copied().unwrap_or_else(|| missing(name))
        };
        let find_item = |path: &[&str]| {
            let root = DefId { krate: vm, index: CRATE_DEF_INDEX };
            path.iter().fold(root, |module, name| {
                child(tcx, module, name).unwrap_or_else(|| missing(name))
            })
        };
        let find_method = |ty: DefId, name: &str| {
            let impls = tcx.inherent_impls(ty).iter();
            let mut methods = impls.flat_map(|&it| tcx.associated_item_def_ids(it)).copied();
            methods.find(|&it| tcx.item_name(it).as_str() == name).unwrap_or_else(|| missing(name))
        };
        let diagnostic_item = |name: &str| tcx.get_diagnostic_item(Symbol::intern(name));
        let (gc, heap) = (find_item(&["Gc"]), find_item(&["heap", "Heap"]));
        Some(Engine {
            gc_free: find_trait("GcFree"),
            trace: find_trait("Trace"),
            cell_kind: find_trait("CellKind"),
            service: find_trait("Service"),
            gc,
            owned: find_item(&["heap", "Owned"]),
            no_gc: find_item(&["NoGc"]),
            gc_ref_mut: find_item(&["heap", "GcRefMut"]),
            call_frame: find_item(&["CallFrame"]),
            ref_cell_guards: ["RefCellRef", "RefCellRefMut"].map(diagnostic_item),
            lend_nothing: ["Cell", "RefCell", "Atomic"].map(diagnostic_item),
            root_alloc: find_item(&["heap", "RootAlloc"]),
            defer_collection: find_item(&["heap", "DeferCollection"]),
            capabilities: [find_item(&["Vm"]), find_item(&["Cx"]), heap],
            formatting: [
                tcx.lang_items().format_argument(),
                tcx.lang_items().format_arguments(),
                diagnostic_item("Formatter"),
            ],
            collector_parts: ["Visitor", "Survivors", "HeapAnalyzer"]
                .map(|name| find_item(&["heap", name])),
            collect: find_method(heap, "collect"),
            upper_crates: crates[position..].iter().copied().filter(in_workspace).collect(),
            workspace_crates: crates.iter().copied().filter(in_workspace).collect(),
        })
    }

    pub fn outlives_cells(&self, def_id: DefId) -> bool {
        self.capabilities.contains(&def_id) || def_id == self.call_frame
    }

    pub fn is_upper(&self, def_id: DefId) -> bool {
        self.upper_crates.contains(&def_id.krate)
    }

    pub fn is_in_workspace(&self, def_id: DefId) -> bool {
        self.workspace_crates.contains(&def_id.krate)
    }
}

/// The `Init` of an `impl CellKind`.
pub fn init_of(tcx: TyCtxt<'_>, impl_id: DefId) -> DefId {
    let mut items = tcx.associated_item_def_ids(impl_id).iter().copied();
    items.find(|&it| tcx.item_name(it).as_str() == "Init").expect("a cell has an `Init`")
}

fn child(tcx: TyCtxt<'_>, module: DefId, name: &str) -> Option<DefId> {
    let children = match module.as_local() {
        Some(module) => tcx.module_children_local(module),
        None => tcx.module_children(module),
    };
    children.iter().find_map(|child| match child.res {
        Res::Def(_, def_id) if child.ident.name.as_str() == name => Some(def_id),
        _ => None,
    })
}
