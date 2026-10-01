import pg from 'pg'
import { preparationReport, preparationReportQuery, type PreparationReportRow } from '../server/preparation-report'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const result = await client.query<PreparationReportRow>(preparationReportQuery)
  console.log(JSON.stringify(preparationReport(result.rows), null, 2))
  await client.query('COMMIT')
} finally { await client.end() }
