export function EvidenceCorrection({ evidenceId, retracted, busy, onRetract }: { evidenceId?: string; retracted?: boolean; busy: boolean; onRetract: () => void }) {
  if (!evidenceId) return null
  return <button className="quiet" disabled={busy || retracted} onClick={onRetract}>这个细节不对</button>
}
