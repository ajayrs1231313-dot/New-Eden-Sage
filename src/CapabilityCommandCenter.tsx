import { useEffect, useMemo, useState } from "react";
import type { CapabilityAnalysis, CapabilityResult, CharacterSnapshot } from "./types";
import { TrainingTimeNotice } from "./TrainingTimeNotice";

type CloneState = "alpha" | "omega";

type Props = {
  snapshot: CharacterSnapshot;
  cloneState?: CloneState;
  onOpenProgression(): void;
};

const money = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);

function duration(seconds: number | null | undefined) {
  if (seconds == null) return "time unavailable";
  if (seconds <= 0) return "ready now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
}

export function CapabilityCommandCenter({ snapshot, cloneState, onOpenProgression }: Props) {
  const [analysis, setAnalysis] = useState<CapabilityAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    window.sage
      .getCapabilities({ characterId: snapshot.characterId, cloneState: cloneState ?? "omega" })
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setSelectedId((current) => result.capabilities.some((item) => item.id === current) ? current : result.capabilities[0]?.id ?? "");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not calculate capability intelligence.");
      })
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [snapshot.characterId, snapshot.updatedAt, cloneState]);

  const selected = useMemo(
    () => analysis?.capabilities.find((item) => item.id === selectedId) ?? analysis?.capabilities[0],
    [analysis, selectedId],
  );

  if (busy && !analysis) {
    return <div className="capability-loading">Building personalised capability intelligence from skills, assets, fittings, wallet and activity readiness…</div>;
  }
  if (error && !analysis) return <div className="capability-loading error">{error}</div>;
  if (!analysis || !selected) return null;

  return (
    <div className="capability-command-center">
      <article className="capability-next-moves">
        <div className="capability-heading">
          <div>
            <p className="eyebrow">PERSONALISED NEXT MOVES</p>
            <h3>Highest-impact upgrades from your current character</h3>
          </div>
          <button onClick={onOpenProgression}>Open Progression</button>
        </div>
        <TrainingTimeNotice cloneState={cloneState} />
        <ol>
          {analysis.topRecommendations.slice(0, 5).map((item, index) => (
            <li key={`${item.capabilityId}-${item.upgrade.type}-${item.upgrade.label}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{item.upgrade.label}</strong>
                <small>{item.capability} · {item.upgrade.why}</small>
                {(item.upgrade.estimatedSeconds != null || item.upgrade.estimatedCost != null) && (
                  <em>
                    {item.upgrade.estimatedSeconds != null ? duration(item.upgrade.estimatedSeconds) : ""}
                    {item.upgrade.estimatedSeconds != null && item.upgrade.estimatedCost != null ? " · " : ""}
                    {item.upgrade.estimatedCost != null ? `~${money(item.upgrade.estimatedCost)} ISK` : ""}
                  </em>
                )}
              </div>
              <b>+{item.upgrade.estimatedGain}%</b>
            </li>
          ))}
        </ol>
        <small className="capability-data-line">
          Using {analysis.dataSignals.ownedShips} owned ship records · {analysis.dataSignals.modules} module assets · {analysis.dataSignals.blueprints} blueprints · {analysis.dataSignals.savedFittings} saved fits · {money(analysis.dataSignals.wallet)} ISK
        </small>
      </article>

      <article className="capability-radar capability-radar-v2">
        <div className="capability-heading">
          <div>
            <p className="eyebrow">CAPABILITY RADAR</p>
            <h3>What can this character actually do now?</h3>
          </div>
          {busy && <small>Refreshing…</small>}
        </div>
        <ol className="capability-bars">
          {analysis.capabilities.map((item) => (
            <li key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}>
              <span>{item.label}</span>
              <div><i style={{ width: `${item.overallPercent}%` }} /></div>
              <strong>{item.overallPercent}%</strong>
            </li>
          ))}
        </ol>

        <CapabilityDetail item={selected} />
      </article>
    </div>
  );
}

function CapabilityDetail({ item }: { item: CapabilityResult }) {
  return (
    <section className="capability-detail">
      <div className="capability-detail-title">
        <div>
          <span>{item.tier}</span>
          <h4>{item.label}</h4>
          <p>{item.description}</p>
        </div>
        <strong>{item.overallPercent}%</strong>
      </div>
      <div className="capability-components">
        <div><span>Practical readiness</span><strong>{item.readinessPercent}%</strong></div>
        <div><span>Owned assets</span><strong>{item.assetPercent}%</strong></div>
        <div><span>Resources</span><strong>{item.resourcePercent}%</strong></div>
      </div>
      <div className="capability-route">
        <span>Best current route</span>
        <strong>{item.bestRoute}</strong>
        {item.bestHull && <small>{item.ownedHull ? "Hull owned" : "Hull not currently owned"}{item.savedFitCount ? ` · ${item.savedFitCount} saved fit${item.savedFitCount === 1 ? "" : "s"}` : ""}</small>}
      </div>
      <div className="capability-strength-grid">
        <div>
          <b>Strengths</b>
          {item.strengths.length ? item.strengths.slice(0, 5).map((text) => <small key={text}>{text}</small>) : <small>No strong positive signal identified yet.</small>}
        </div>
        <div>
          <b>Weaknesses</b>
          {item.weaknesses.length ? item.weaknesses.slice(0, 5).map((text) => <small key={text}>{text}</small>) : <small>No major identified gap for this representative target.</small>}
        </div>
      </div>
      <div className="capability-upgrades">
        <b>Best improvements</b>
        {item.upgrades.slice(0, 4).map((upgrade) => (
          <div key={`${upgrade.type}-${upgrade.label}`}>
            <span><strong>{upgrade.label}</strong><small>{upgrade.why}</small></span>
            <em>+{upgrade.estimatedGain}%</em>
          </div>
        ))}
      </div>
      <details className="capability-show-work">
        <summary>Show Work — why {item.overallPercent}%?</summary>
        {item.showWork.map((line) => <small key={line}>{line}</small>)}
      </details>
    </section>
  );
}
