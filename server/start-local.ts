import { mkdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './index'
import { localPool } from './local-pool'
import { registerShutdown } from './shutdown'

await mkdir('.local-db', { recursive: true })
const db = new PGlite('.local-db')
await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
const pool = localPool(db)
const app = createApp(pool, '.local-assets')
app.addHook('onClose', async () => { await db.close() })
registerShutdown(app)
await app.listen({ port: Number(process.env.PORT || 3001), host: '127.0.0.1' })
