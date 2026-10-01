export function frameMeasurement() {
  const frames: Array<{ atMs: number; visible: boolean; playback: string }> = []
  return {
    record(atMs: number, visible: boolean, playback: string) { frames.push({ atMs, visible, playback }) },
    report() {
      const intervals = frames.slice(1).map((frame, index) => frame.atMs - frames[index].atMs)
      const durationMs = frames.length > 1 ? frames[frames.length - 1].atMs - frames[0].atMs : 0
      const withinBudget = intervals.filter(value => value <= 33.3).length
      const withinBudgetRatio = intervals.length ? withinBudget / intervals.length : null
      const freezes = intervals.filter(value => value > 500).length
      const hiddenFrames = frames.filter(frame => !frame.visible).length
      return { scope: 'render completion intervals; includes idle and paused states; not GPU timing or audio synchronization', durationMs, frames, intervalsMs: intervals, withinBudgetRatio, freezesOver500Ms: freezes, hiddenFrames, meetsFrameThreshold: durationMs >= 90000 && hiddenFrames === 0 && withinBudgetRatio !== null && withinBudgetRatio >= .95 && freezes === 0 }
    },
  }
}
