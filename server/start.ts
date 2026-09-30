import pg from 'pg'
import { createApp } from './index'
import { registerShutdown } from './shutdown'
import { serverConfig } from './config'

const config = serverConfig(process.env)
const pool = new pg.Pool({ connectionString: config.databaseUrl })
const app = createApp(pool, config.assetDir)
app.addHook('onClose', async () => { await pool.end() })
registerShutdown(app)
await app.listen({ port: config.port, host: '127.0.0.1' })
