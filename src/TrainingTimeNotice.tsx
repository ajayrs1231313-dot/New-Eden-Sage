type CloneState = "alpha" | "omega";

export function TrainingTimeNotice({
  cloneState,
}: {
  cloneState?: CloneState;
}) {
  if (cloneState) return null;

  return (
    <div className="training-time-notice" role="status">
      Confirm Alpha/Omega on the character card for exact training-time estimates.
    </div>
  );
}
