import { useEffect, useState } from "react";
import type { CapabilityAnalysis, CharacterSnapshot } from "./types";

type CloneState = "alpha" | "omega";

export function ProgressionPriorities({ snapshot, cloneState }: { snapshot: CharacterSnapshot; cloneState?: CloneState }) {
  const [analysis, setAnalysis] = useState<CapabilityAnalysis | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.sage
      .getCapabilities({ characterId: snapshot.characterId, cloneState: cloneState ?? "omega" })
      .then((result) => !cancelled && setAnalysis(result))
      .catch(() => !cancelled && setAnalysis(null));
    return () => { cancelled = true; };
  }, [snapshot.characterId, snapshot.updatedAt, cloneState]);

  if (!analysis?.topRecommendations.length) return null;
  const strongest = analysis.capabilities[0];

  return (
    <section className="progression-priorities">
      <div className="progression-priorities-head">
        <div>
          <p className="eyebrow">PERSONALISED PRIORITIES</p>
          <h3>Best next improvements across this character</h3>
        </div>
        {strongest && <span>Strongest now: <b>{strongest.label} {strongest.overallPercent}%</b></span>}
      </div>
      <div className="progression-priority-grid">
        {analysis.topRecommendations.slice(0, 3).map((item) => (
          <article key={`${item.capabilityId}-${item.upgrade.type}-${item.upgrade.label}`}>
            <small>{item.capability}</small>
            <strong>{item.upgrade.label}</strong>
            <p>{item.upgrade.why}</p>
            <b>+{item.upgrade.estimatedGain}% capability</b>
          </article>
        ))}
      </div>
      <small className="progression-priorities-note">These are the same shared capability calculations used on Command; Activity Planner provides the underlying contextual readiness.</small>
    </section>
  );
}
