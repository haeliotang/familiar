export type InputFile = readonly ['photo' | 'deceased_audio' | 'user_memory_audio', File]

const errorMessages: Record<string, string> = {
  audio_observation_not_ready: '请先检查录音，再核对片段。',
  audio_observation_changed: '录音或分析结果已变化，请重新分析并核对。',
  audio_analysis_unavailable: '录音分析暂不可用，已保留原文件，可以稍后重新检查。',
  idempotency_conflict: '这次请求对应另一份资料，请重新发起相遇。',
  audio_processor_unavailable: '录音处理暂不可用，已保留上传文件，请稍后重试。',
  photo_decoder_unavailable: '照片处理暂不可用，已保留上传文件，请稍后重试。',
  local_transcriber_busy: '本地正在转写另一份录音，请稍后重试。',
  confirmation_retracted: '这段确认内容已撤回或替换，请核对并修改后再确认。',
  audio_not_ready: '录音尚未完成处理，请稍后重试。',
  transcript_not_ready: '请先完成录音转写，再确认文字。',
  not_memory_audio: '此入口只处理你讲述记忆的录音。',
  local_transcription_unavailable: '本地转写暂不可用，可以重试或跳过转写。',
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } })
  if (!response.ok) {
    let code: unknown
    try { code = (await response.json())?.code } catch { /* upstream may return a non-JSON error */ }
    const message = typeof code === 'string' && Object.hasOwn(errorMessages, code) ? errorMessages[code] : undefined
    throw new Error(message || (response.status === 404 ? '这段资料已不可访问。' : response.status === 409 ? '这份资料暂无可用线索，或已达到上传限额。' : response.status === 415 ? '文件格式或大小暂不支持。' : `暂时无法完成（${response.status}）。`))
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function uploadFile(personId: string, kind: InputFile[0], file: File) {
  const extension = kind === 'photo' ? file.name.toLowerCase().match(/\.(heic|heif)$/)?.[1] : undefined
  const mediaType = file.type || (extension ? `image/${extension}` : '')
  const intent = await api<{ assetId: string; uploadUrl: string }>('/v1/assets/upload-intents', {
    method: 'POST', body: JSON.stringify({ personId, kind, mediaType, sizeBytes: file.size }),
  })
  const uploaded = await fetch(intent.uploadUrl, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
  if (!uploaded.ok) throw new Error(`文件上传失败（${uploaded.status}）。`)
  await api(`/v1/assets/${intent.assetId}/complete`, { method: 'POST' })
  return intent.assetId
}

export async function submitEvidence(personId: string, memory: string, selected: InputFile[], onUploaded?: (kind: InputFile[0], assetId: string) => void) {
  const uploadErrors: string[] = []
  for (const [kind, file] of selected) {
    try {
      const assetId = await uploadFile(personId, kind, file)
      onUploaded?.(kind, assetId)
    }
    catch (cause) { uploadErrors.push(`${file.name}：${cause instanceof Error ? cause.message : '无法处理'}`) }
  }
  if (memory.trim()) await api(`/v1/persons/${personId}/memories`, { method: 'POST', body: JSON.stringify({ text: memory.trim() }) })
  return uploadErrors
}
