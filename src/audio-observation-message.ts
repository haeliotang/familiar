export function audioObservationMessage(status: string | undefined) {
  if (status === 'insufficient_energy') return '这段录音较短或较安静，暂不足以分析说话节奏。可以选择更清晰的录音；本次仍使用预设声音。'
  if (status === 'clipped') return '这段录音可能有失真。可以选择更清晰的录音；本次仍使用预设声音。'
  return '已完成录音信号检查。尚未确认说话主体或提取个人说话节奏，本次仍使用预设声音。'
}
