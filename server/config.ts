import { isAbsolute } from 'node:path'

export function serverConfig(env: NodeJS.ProcessEnv) {
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required')
  if (!env.ASSET_DIR?.trim()) throw new Error('ASSET_DIR is required')
  if (!isAbsolute(env.ASSET_DIR)) throw new Error('ASSET_DIR must be an absolute private directory')
  const port = env.PORT === undefined ? 3001 : Number(env.PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535')
  return { databaseUrl: env.DATABASE_URL, assetDir: env.ASSET_DIR, port }
}
