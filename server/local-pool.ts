import type { PGlite } from '@electric-sql/pglite'
import type pg from 'pg'

export function localPool(db: PGlite): pg.Pool {
  let queue = Promise.resolve()
  async function acquire() {
    const previous = queue
    let unlock!: () => void
    queue = new Promise<void>(resolve => { unlock = resolve })
    await previous
    let released = false
    return () => { if (!released) { released = true; unlock() } }
  }
  const query = (text: string, values?: unknown[]) => db.query(text, values)
  return {
    query: async (text: string, values?: unknown[]) => {
      const release = await acquire()
      try { return await query(text, values) } finally { release() }
    },
    connect: async () => {
      const release = await acquire()
      return { query, release }
    },
  } as unknown as pg.Pool
}
