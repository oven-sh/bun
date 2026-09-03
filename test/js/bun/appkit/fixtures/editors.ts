// TextEditor and Table are built through the bridge: the NSTextView /
// NSTableView inside `.native` (an NSScrollView), the delegate and data
// source objects the classes install, live getters, and events driven the
// way AppKit drives them (the delegate methods, the double action).
import { app, Table, TextEditor, VStack, Window } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

function attempt(f: () => unknown) {
  try {
    f();
    return { threw: false };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { threw: true, isTypeError: err instanceof TypeError, message: String(err?.message), code: err?.code };
  }
}

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSIndexSet } = objc.classes;
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push((e as Error).message));

  {
    const changes: string[] = [];
    const editor = new TextEditor({ value: "abc", onChange: value => changes.push(value) });
    const other = new TextEditor();
    const stack = new VStack({ children: [editor, other] });
    const win = new Window({ width: 300, height: 200, content: stack, visible: false });
    const scroll = editor.native;
    const text = scroll.documentView();
    const delegate = text.delegate();
    const undo = delegate.undoManagerForTextView_(text);
    // A user edit goes through shouldChangeText/didChangeText, so the delegate hears it and undo records it.
    text.insertText_replacementRange_("x", { location: 0, length: 0 });
    const afterInsert = { value: editor.value, changes: changes.slice(), canUndo: undo.canUndo() };
    editor.value = "reset";
    const afterSet = { value: text.string().UTF8String(), changes: changes.slice(), canUndo: undo.canUndo() };
    text.setEditable_(false);
    editor.font = { design: "monospaced", size: 13 };
    editor.color = "red";
    const red = String(text.textColor()) === String(objc.classes.NSColor.systemRedColor());
    editor.color = null;
    emit({
      step: "text editor",
      outer: String(scroll.class()),
      inner: String(text.class()),
      richText: text.isRichText(),
      conforms: delegate.conformsToProtocol_(objc.protocols.NSTextViewDelegate),
      ownUndo:
        undo === delegate.undoManagerForTextView_(text) &&
        undo !== other.native.documentView().delegate().undoManagerForTextView_(other.native.documentView()),
      undoClass: String(undo.class()),
      afterInsert,
      afterSet,
      editable: editor.editable,
      pointSize: text.font().pointSize(),
      font: editor.font,
      red,
      colorBack: String(text.textColor()) === String(objc.classes.NSColor.textColor()),
      uncaught: uncaught.splice(0),
    });
    win.close();
  }

  {
    const selects: number[][] = [];
    const activations: number[] = [];
    const table = new Table({
      columns: ["Name", { id: "size", title: "Size", width: 60 }],
      rows: [["alpha", "1"], ["beta"], ["gamma", 3, "extra"]],
      onSelect: indexes => selects.push(indexes),
      onActivate: row => activations.push(row),
    });
    const win = new Window({ width: 320, height: 240, content: table, visible: false });
    const scroll = table.native;
    const view = scroll.documentView();
    const source = view.dataSource();
    const columns = view.tableColumns();
    const first = columns.objectAtIndex_(0);
    const second = columns.objectAtIndex_(1);
    const cellText = (column: unknown, row: number) => {
      const cell = source.tableView_viewForTableColumn_row_(view, column, row);
      return cell === null ? null : { kind: String(cell.class()), text: cell.textField().stringValue().UTF8String() };
    };
    const cells = [
      cellText(first, 0),
      cellText(second, 0),
      cellText(second, 1),
      cellText(second, 2),
      cellText(null, 0),
    ];
    const stranger = objc.classes.NSTableColumn.alloc().initWithIdentifier_("stranger");
    const strangerCell = cellText(stranger, 0);
    // The user selecting a row: the delegate hears it and onSelect runs; the setter's own change does not echo.
    view.selectRowIndexes_byExtendingSelection_(NSIndexSet.indexSetWithIndex_(1), false);
    const afterUser = selects.slice();
    table.selectedIndexes = [0];
    const afterSetter = selects.slice();
    // The double action with no clicked row (-1 headless) reports nothing.
    view.target().action_(view);
    second.setWidth_(77);
    const liveColumns = table.columns;
    // A column a script adds to the NSTableView shows in `columns` (its cells stay empty) and goes with the next assignment.
    view.addTableColumn_(stranger);
    const withStranger = { ids: table.columns.map(c => c.id), cell: cellText(stranger, 0) };
    table.headerVisible = false;
    const hiddenHeader = view.headerView();
    table.headerVisible = null;
    table.columns = null as never;
    const implicit = {
      columns: table.columns,
      count: view.tableColumns().count(),
      id: view.tableColumns().objectAtIndex_(0).identifier().UTF8String(),
      header: view.headerView(),
    };
    table.rowHeight = 30;
    const rowHeight = { set: table.rowHeight, native: view.rowHeight() };
    table.rowHeight = null as never;
    view.setUsesAlternatingRowBackgroundColors_(true);
    view.setAllowsMultipleSelection_(true);
    emit({
      step: "table",
      outer: String(scroll.class()),
      inner: String(view.class()),
      sameDelegate: source === view.delegate(),
      target: String(view.target().class()),
      conforms: [
        source.conformsToProtocol_(objc.protocols.NSTableViewDataSource),
        source.conformsToProtocol_(objc.protocols.NSTableViewDelegate),
      ],
      doubleAction: String(view.doubleAction()),
      action: view.action(),
      numberOfRows: source.numberOfRowsInTableView_(view),
      cells,
      strangerCell,
      afterUser,
      afterSetter,
      activations,
      liveColumns,
      withStranger,
      hiddenHeader,
      implicit,
      rowHeight,
      rowHeightBack: table.rowHeight === view.rowHeight() && table.rowHeight !== 30,
      alternating: table.alternatingRows,
      multiple: table.multiple,
      rows: table.rows,
      badRows: attempt(() => (table.rows = [{}] as never)),
      badColumns: attempt(() => (table.columns = [5] as never)),
      badColumnTitle: attempt(() => (table.columns = [{ id: "x" }] as never)),
      badIndexes: attempt(() => (table.selectedIndexes = ["a"] as never)),
      badIndexesShape: attempt(() => (table.selectedIndexes = 3 as never)),
      uncaught: uncaught.splice(0),
    });
    win.close();
  }

  {
    // Options given together at construction: the selection holds whatever their order, and reports nothing.
    const selects: number[][] = [];
    const table = new Table({
      selectedIndexes: [1, 5],
      multiple: true,
      rows: [["a"], ["b"]],
      onSelect: i => selects.push(i),
    });
    const view = table.native.documentView();
    // Single selection keeps the lowest of several.
    const later = new Table({ selectedIndexes: [2, 0], rows: [["a"], ["b"], ["c"]] });
    emit({
      step: "selected at construction",
      selected: table.selectedIndexes,
      native: [view.selectedRowIndexes().containsIndex_(1), view.numberOfSelectedRows()],
      rows: view.numberOfRows(),
      selects,
      later: later.selectedIndexes,
      uncaught: uncaught.splice(0),
    });
    // An index past the last row is remembered and selected once the rows reach it.
    table.rows = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]];
    emit({ step: "remembered index", selected: table.selectedIndexes, selects, uncaught: uncaught.splice(0) });
  }

  {
    // A Table collected while a script still holds its NSTableView: the data source answers an empty table.
    let view: any;
    let source: any;
    const ref = (() => {
      const table = new Table({ rows: [["a"], ["b"]] });
      view = table.native.documentView();
      source = view.dataSource();
      return new WeakRef(table);
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return ref.deref() === undefined;
      },
      "table to be collected",
      5000,
    );
    emit({
      step: "orphaned data source",
      rows: source.numberOfRowsInTableView_(view),
      cell: source.tableView_viewForTableColumn_row_(view, view.tableColumns().objectAtIndex_(0), 0),
      uncaught: uncaught.splice(0),
    });
  }
});
