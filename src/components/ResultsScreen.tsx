import { useState } from "react";
import { formatBytes } from "../lib/format";
import {
  filterRows,
  formatLine,
  keptAtNativeSize,
  needsALook,
  copyReport,
  canLowerQuality,
  outputName,
  suggestedMaxKb,
  resultsFooter,
  resultsHeading,
  revealTarget,
  rowNote,
  savedPercent,
  statusLabel,
  writtenTotals,
  type ResultFilter,
  type ResultRow,
  type RunReport,
} from "../lib/results";
import { BackToAllImages } from "./BackToAllImages";

export function ResultsScreen({
  report,
  busyId,
  onBack,
  onReveal,
  onRaiseMax,
  onLowerQuality,
  onAdjustCrop,
  onRevealOriginal,
}: {
  report: RunReport;
  busyId: string | null;
  onBack: () => void;
  onReveal: (path: string) => void;
  onRaiseMax: (row: ResultRow, maxKb: number) => void;
  onLowerQuality: (row: ResultRow) => void;
  onAdjustCrop: (row: ResultRow) => void;
  onRevealOriginal: (row: ResultRow) => void;
}) {
  const [filter, setFilter] = useState<ResultFilter>("all");
  const rows = filterRows(report.rows, filter);
  const { before, after } = writtenTotals(report.rows);
  const saved = savedPercent(before, after);
  const lookCount = report.rows.filter(needsALook).length;
  const nativeCount = report.rows.filter(keptAtNativeSize).length;
  const tabs: { id: ResultFilter; label: string }[] = [
    { id: "all", label: `All (${report.rows.length})` },
    { id: "look", label: `Needs a look (${lookCount})` },
    { id: "native", label: `Not upscaled (${nativeCount})` },
  ];

  return (
    <section className="results" aria-label="Batch results">
      <div className="screen-bar">
        <BackToAllImages onClick={onBack} />
      </div>
      <div className="results-body">
        <header className="results-head">
          <h2>{resultsHeading(report)}</h2>
          <p className="hint">
            {`${report.recipeName} · ${report.pattern} · start ${report.sequenceStart} · ${report.folderLabel}`}
          </p>
        </header>
        <div className="results-tiles">
          <Tile label="Before" value={formatBytes(before)} />
          <Tile label="After" value={formatBytes(after)} />
          <Tile label="Saved" value={`${saved}% · ${formatBytes(Math.abs(before - after))}`} good />
          <Tile label="Time" value={report.elapsed} />
        </div>
        <div className="results-tabs" role="tablist" aria-label="Result filters">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={filter === tab.id ? "results-tab is-on" : "results-tab"}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="results-table">
          <div className="results-columns" aria-hidden="true">
            <span />
            <span>File</span>
            <span>Size</span>
            <span>Saved</span>
            <span>Status</span>
          </div>
          {rows.length === 0 ? <p className="hint results-empty">Nothing in this filter.</p> : null}
          {rows.map((row) => (
            <ResultCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onReveal={onReveal}
              onRaiseMax={onRaiseMax}
              onLowerQuality={onLowerQuality}
              onAdjustCrop={onAdjustCrop}
              onRevealOriginal={onRevealOriginal}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function ResultsFooter({
  report,
  onReveal,
  onCopy,
}: {
  report: RunReport;
  onReveal: (path: string) => void;
  onCopy: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const target = revealTarget(report.rows);
  return (
    <footer className="bottom-bar">
      <p className="summary" role="status">
        {resultsFooter(report)}
      </p>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => {
          void onCopy(copyReport(report)).then(() => setCopied(true)).catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy report"}
      </button>
      <button type="button" className="squeeze" disabled={!target} onClick={() => target && onReveal(target)}>
        Reveal in Finder
      </button>
    </footer>
  );
}

function Tile({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="results-tile">
      <span>{label}</span>
      <strong className={good ? "is-good" : undefined}>{value}</strong>
    </div>
  );
}

function ResultCard({
  row,
  busy,
  onReveal,
  onRaiseMax,
  onLowerQuality,
  onAdjustCrop,
  onRevealOriginal,
}: {
  row: ResultRow;
  busy: boolean;
  onReveal: (path: string) => void;
  onRaiseMax: (row: ResultRow, maxKb: number) => void;
  onLowerQuality: (row: ResultRow) => void;
  onAdjustCrop: (row: ResultRow) => void;
  onRevealOriginal: (row: ResultRow) => void;
}) {
  const note = rowNote(row);
  const percent = row.status === "written" && row.sourceBytes > 0 && row.bytes !== null
    ? savedPercent(row.sourceBytes, row.bytes)
    : null;
  const chip = statusLabel(row);
  const chipClass = chipClassName(row);
  return (
    <article className="results-row">
      {row.thumbnailUrl ? (
        <img className="results-thumb" src={row.thumbnailUrl} alt="" />
      ) : (
        <span className="results-thumb" aria-hidden="true" />
      )}
      <div className="results-file">
        <strong title={outputName(row)}>{outputName(row)}</strong>
        <span className="hint">{dimensionLine(row)}</span>
        {note ? <span className="results-note">{note}</span> : null}
        <span className="results-actions">
          {row.status === "written" && row.targetMissed && row.bytes !== null ? (
            <RaiseMax bytes={row.bytes} busy={busy} onSubmit={(maxKb) => onRaiseMax(row, maxKb)} />
          ) : null}
          {canLowerQuality(row) ? (
            <button type="button" className="text-button" disabled={busy} onClick={() => onLowerQuality(row)}>
              Allow lower quality
            </button>
          ) : null}
          {row.status === "written" && row.croppedHeavily ? (
            <button type="button" className="text-button" disabled={busy} onClick={() => onAdjustCrop(row)}>
              Adjust crop
            </button>
          ) : null}
          {row.status === "failed" && row.sourcePath ? (
            <button type="button" className="text-button" disabled={busy} onClick={() => onRevealOriginal(row)}>
              Show in Finder
            </button>
          ) : null}
          {row.path && row.status !== "failed" ? (
            <button type="button" className="text-button" disabled={busy} onClick={() => onReveal(row.path as string)}>
              Reveal
            </button>
          ) : null}
        </span>
      </div>
      <span className="results-size">
        {row.status === "written" && row.bytes !== null
          ? `${formatBytes(row.sourceBytes)} → ${formatBytes(row.bytes)}`
          : "Not saved"}
      </span>
      <span className="results-saved">
        <span className="results-bar" aria-hidden="true">
          {percent !== null ? <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /> : null}
        </span>
        <span className="results-percent">{percent === null ? "—" : `${percent}%`}</span>
      </span>
      <span className="results-status">
        <span className={chipClass}>{chip}</span>
        {row.custom ? <span className="results-chip is-custom">Custom</span> : null}
      </span>
    </article>
  );
}

function dimensionLine(row: ResultRow): string {
  const before = `${row.sourceWidth}×${row.sourceHeight}`;
  const format = formatLine(row);
  if (!row.width || !row.height) return format ? `${before} · ${format}` : before;
  const size = `${before} → ${row.width}×${row.height}`;
  return format ? `${size} · ${format}` : size;
}

function chipClassName(row: ResultRow): string {
  if (row.status === "failed" || row.status === "skipped" || row.targetMissed || statusLabel(row) === "Larger than the original") {
    return "results-chip is-attention";
  }
  if (row.keptNative) return "results-chip is-native";
  return "results-chip";
}

function RaiseMax({ bytes, busy, onSubmit }: { bytes: number; busy: boolean; onSubmit: (maxKb: number) => void }) {
  const suggested = suggestedMaxKb(bytes);
  const [text, setText] = useState(String(suggested));
  const [shownFor, setShownFor] = useState(bytes);
  if (shownFor !== bytes) {
    setShownFor(bytes);
    setText(String(suggested));
  }
  const kb = Number(text);
  const ready = Number.isInteger(kb) && kb >= 1 && kb <= 1_000_000;
  return (
    <form
      className="results-raise"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit(kb);
      }}
    >
      <label>
        Raise max to
        <input
          type="number"
          min={1}
          max={1_000_000}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        KB
      </label>
      <button type="submit" className="text-button" disabled={busy || !ready}>
        Raise
      </button>
    </form>
  );
}
