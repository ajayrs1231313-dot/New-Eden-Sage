import { useState } from "react";

const modes = [
  ["top", "Top 20 arbitrage"],
  ["top1000", "Top 1,000 arbitrage"],
  ["widened", "Margins widened today"],
  ["likely", "Orders likely to fill"],
  ["capital", "Capital-efficient trades"],
  ["under10", "Hauls under 10 jumps"],
  ["wallet100m", "Best for a 100M wallet"],
  ["viator", "Best for a Viator"],
  ["iskm3", "Best by ISK/m3"],
] as const;

type Mode = (typeof modes)[number][0];

export function IskLab() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeMode, setActiveMode] = useState<Mode>("top");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState(
    "Scan the newest 20-jump dataset for industrial-hauler trades worth at least 10 million ISK.",
  );
  async function scan(mode: Mode) {
    setActiveMode(mode);
    setPage(0);
    setBusy(true);
    setResult(null);
    setStatus(
      "Checking prices, cargo volumes, routes and loaded characters...",
    );
    try {
      const next = await window.sage.findRadiusTrades(mode);
      setResult(next);
      const diagnostics = next.diagnostics;
      setStatus(
        next.message ??
          `Showing ${next.opportunities.length} ranked opportunities${
            diagnostics
              ? ` from ${diagnostics.sourceItems.toLocaleString()} items, ${diagnostics.viablePairs.toLocaleString()} viable price pairs and ${diagnostics.reachableRoutes.toLocaleString()} reachable routes.`
              : "."
          }`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Opportunity scan failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportTop1000() {
    setBusy(true);
    setStatus("Building and exporting the Top 1,000 arbitrage dataset...");
    try {
      const file = await window.sage.exportTopArbitrage();
      if (file) setStatus(`Top 1,000 dataset saved to ${file}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  const filtered = (result?.opportunities ?? []).filter((trade: any) =>
    `${trade.item} ${trade.sell.regionName} ${trade.buy.regionName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pageSize = activeMode === "top1000" ? 50 : 20;
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <section className="isk-lab">
      <div className="isk-head">
        <div>
          <p className="eyebrow">LOCAL TRADE ENGINE</p>
          <h2>ISK Lab</h2>
          <p>{status}</p>
        </div>
      </div>
      <div className="isk-modes">
        {modes.map(([mode, label]) => (
          <button
            key={mode}
            className={activeMode === mode ? "selected" : ""}
            onClick={() => scan(mode)}
            disabled={busy}
          >
            {busy && activeMode === mode ? "Scanning..." : label}
          </button>
        ))}
      </div>
      <div className="isk-tools">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Search item or region..."
        />
        <button onClick={exportTop1000} disabled={busy}>
          Export Top 1,000 CSV
        </button>
      </div>
      {result?.haulers?.length > 0 && (
        <div className="hauler-strip">
          {result.haulers.map((hauler: any) => (
            <article key={hauler.characterId}>
              <strong>{hauler.character}</strong>
              <span>{hauler.capacityM3.toLocaleString()} m3</span>
              <small>{hauler.basis}</small>
            </article>
          ))}
        </div>
      )}
      {result?.opportunities && (
        <div className="trade-opportunities">
          <div className="trade-row heading">
            <span>Item</span>
            <span>Buy stock</span>
            <span>Sell to buyer</span>
            <span>Units / cargo</span>
            <span>Jumps</span>
            <span>Gross profit</span>
          </div>
          {visible.map((trade: any) => (
            <div
              className="trade-row"
              key={`${trade.typeId}-${trade.sell.orderId}-${trade.buy.orderId}`}
            >
              <span>
                <strong>{trade.item}</strong>
                <small>{trade.volumeM3.toLocaleString()} m3 each</small>
              </span>
              <span>
                <strong>{trade.sell.systemName}</strong>
                <small>
                  {trade.sell.locationName}
                  <br />
                  {trade.sell.regionName}
                  <br />
                  {Math.round(trade.sell.price).toLocaleString()} ISK
                </small>
              </span>
              <span>
                <strong>{trade.buy.systemName}</strong>
                <small>
                  {trade.buy.locationName}
                  <br />
                  {trade.buy.regionName}
                  <br />
                  {Math.round(trade.buy.price).toLocaleString()} ISK
                </small>
              </span>
              <span>
                {trade.units.toLocaleString()}
                <small>
                  {Math.round(trade.cargoM3).toLocaleString()} m3
                  <br />
                  {Math.round(trade.investment).toLocaleString()} ISK invested
                </small>
              </span>
              <span>
                {trade.jumps}
                <small>
                  {Math.round(trade.iskPerJump).toLocaleString()} ISK/jump
                  <br />
                  Risk: {trade.risk}
                </small>
              </span>
              <span className="profit">
                {Math.round(trade.profit).toLocaleString()} ISK
                <small>
                  {trade.marginPercent.toFixed(1)}% return
                  <br />
                  {Number.isFinite(trade.iskPerM3)
                    ? `${Math.round(trade.iskPerM3).toLocaleString()} ISK/m3`
                    : "No cargo volume"}
                  <br />
                  Fill score {trade.fillScore}/100
                  {trade.marginWidenedBy != null && (
                    <>
                      <br />
                      Margin change{" "}
                      {Math.round(trade.marginWidenedBy).toLocaleString()} ISK
                    </>
                  )}
                  <br />
                  {trade.hauler.character}
                </small>
              </span>
            </div>
          ))}
          {filtered.length > pageSize && (
            <div className="isk-pagination">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page * pageSize + 1}-
                {Math.min((page + 1) * pageSize, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <button
                disabled={(page + 1) * pageSize >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
