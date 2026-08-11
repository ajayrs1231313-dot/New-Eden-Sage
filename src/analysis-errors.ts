export function analysisErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function isExpectedAnalysisCancellation(error: unknown) {
  const message = analysisErrorMessage(error);
  return /Replaced by a newer analysis request|Analysis request superseded|ANALYSIS_CANCELLED|Analysis cancelled/i.test(message);
}

export function friendlyAnalysisError(error: unknown, fallback: string) {
  const message = analysisErrorMessage(error);
  if (/ANALYSIS_WATCHDOG|stopped responding/i.test(message)) return "Analysis took too long. Sage restarted it automatically; refresh to try again.";
  if (/ANALYSIS_WORKER_(CRASH|EXIT)|worker crashed|worker exited unexpectedly/i.test(message)) return "The background analysis worker restarted. Refresh to try again.";
  return message || fallback;
}
