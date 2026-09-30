import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query(await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8'))
} finally {
  await client.end()
}
