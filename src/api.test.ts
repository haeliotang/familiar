import { afterEach, expect, it, vi } from 'vitest'
import { api, submitEvidence } from './api'

afterEach(() => vi.unstubAllGlobals())

it.each([
  [503, 'audio_processor_unavailable', '录音处理暂不可用，已保留上传文件，请稍后重试。'],
  [503, 'photo_decoder_unavailable', '照片处理暂不可用，已保留上传文件，请稍后重试。'],
  [429, 'local_transcriber_busy', '本地正在转写另一份录音，请稍后重试。'],
  [409, 'confirmation_retracted', '这段确认内容已撤回或替换，请核对并修改后再确认。'],
  [409, 'audio_not_ready', '录音尚未完成处理，请稍后重试。'],
])('explains transcription failure %s/%s', async (status, code, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json: async () => ({ code }) })))
  await expect(api('/v1/assets/test/transcription')).rejects.toThrow(message)
})

it('uses a safe status message when the error response is not JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('invalid json') } })))
  await expect(api('/v1/assets/test/transcription')).rejects.toThrow('暂时无法完成（502）。')
})

it('allows a file-only first encounter without sending an empty memory', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    paths.push(path)
    const data = path === '/v1/assets/upload-intents' ? { assetId: 'asset-1', uploadUrl: '/v1/assets/asset-1/content' } : {}
    return { ok: true, status: 200, json: async () => data }
  }))
  const file = new File(['image'], 'sample.jpg', { type: 'image/jpeg' })
  await submitEvidence('person-1', '', [['photo', file]])
  expect(paths).toEqual(['/v1/assets/upload-intents', '/v1/assets/asset-1/content', '/v1/assets/asset-1/complete'])
})

it('reports the memory asset for review only after conversion succeeds', async () => {
  const ready = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, status: 200, json: async () => path === '/v1/assets/upload-intents' ? { assetId: 'memory-1', uploadUrl: '/v1/assets/memory-1/content' } : {} })))
  const file = new File(['synthetic'], 'memory.wav', { type: 'audio/wav' })
  expect(await submitEvidence('person-1', '', [['user_memory_audio', file]], ready)).toEqual([])
  expect(ready).toHaveBeenCalledWith('user_memory_audio', 'memory-1')
  ready.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: !path.endsWith('/complete'), status: path.endsWith('/complete') ? 422 : 200, json: async () => ({ assetId: 'memory-2', uploadUrl: '/v1/assets/memory-2/content' }) })))
  expect(await submitEvidence('person-1', '', [['user_memory_audio', file]], ready)).toHaveLength(1)
  expect(ready).not.toHaveBeenCalled()
})

it('supplies HEIC media type when the browser leaves it empty', async () => {
  let mediaType: string | undefined
  vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
    if (path === '/v1/assets/upload-intents') mediaType = JSON.parse(options.body as string).mediaType
    return { ok: true, status: 200, json: async () => ({ assetId: 'heic-1', uploadUrl: '/v1/assets/heic-1/content' }) }
  }))
  expect(await submitEvidence('person-1', '', [['photo', new File(['synthetic'], 'sample.HEIC')]])).toEqual([])
  expect(mediaType).toBe('image/heic')
})
