import type { ReactNode } from "react";
import "./panel-pager.css";

export function PanelPager({
  page,
  pageCount,
  onPageChange,
  label = "Page",
  leading,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  label?: string;
  leading?: ReactNode;
}) {
  const safeCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(0, page), safeCount - 1);
  const previousDisabled = safePage <= 0;
  const nextDisabled = safePage >= safeCount - 1;

  return <div className="panel-pager" aria-label={label}>
    {leading ? <div className="panel-pager__leading">{leading}</div> : <span />}
    <div className="panel-pager__controls">
      <span className="panel-pager__count">
        <b>{String(safePage + 1).padStart(2, "0")}</b>
        <i>/</i>
        <span>{String(safeCount).padStart(2, "0")}</span>
      </span>
      <button
        type="button"
        className="panel-pager__arrow"
        disabled={previousDisabled}
        onClick={() => onPageChange(safePage - 1)}
        aria-label="Previous page"
        title="Previous page"
      >
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m11.5 4.5-4.5 4.5 4.5 4.5" /></svg>
      </button>
      <button
        type="button"
        className="panel-pager__arrow"
        disabled={nextDisabled}
        onClick={() => onPageChange(safePage + 1)}
        aria-label="Next page"
        title="Next page"
      >
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m6.5 4.5 4.5 4.5-4.5 4.5" /></svg>
      </button>
    </div>
  </div>;
}
