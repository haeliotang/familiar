import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { expect, it } from 'vitest'

it('blocks private local files through static, filesystem and raw-module requests', async () => {
  const name = `familiar-test-${randomUUID()}.txt`
  const paths = [...['.local-assets', '.local-db', '.models'].map(directory => `${directory}/${name}`), `.env.${name}`, `${name}.pem`]
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, appType: 'custom', logLevel: 'silent' })
  try {
    for (const path of paths) {
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 })
      await writeFile(path, 'synthetic-private-marker', { mode: 0o600 })
    }
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing')
    const base = `http://127.0.0.1:${address.port}`
    for (const path of paths) {
      for (const request of [`/${path}`, `/@fs${resolve(path)}`, `/${path}?raw`]) {
        const response = await fetch(base + request)
        expect(response.status, request).toBe(403)
        expect(await response.text()).not.toContain('synthetic-private-marker')
      }
    }
    expect((await fetch(base + '/assets/voices/kokoro-zh-zm009-v1/general.wav')).status).toBe(200)
  } finally {
    await server.close()
    await Promise.all(paths.map(path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })))
  }
})
