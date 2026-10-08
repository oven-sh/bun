const funnelSnapshotCard = (report === MY_OVERVIEW &&
  !ReportGK.xar_metrics_active_capitol_v2) ||
  (report === COMPANY_OVERVIEW &&
    !ReportGK.xar_metrics_active_capitol_v2_company_metrics)
  ? <ReportMetricsFunnelSnapshotCard metrics={metrics} />
  : null;

room = room.map((row, rowIndex) => (
  row.map((col, colIndex) => (
    (rowIndex === 0 || colIndex === 0 || rowIndex === height || colIndex === width) ? 1 : 0
  ))
))
