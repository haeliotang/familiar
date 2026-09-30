import { expect, it } from 'vitest'
import { serverConfig } from './config'

const valid = { DATABASE_URL: 'postgres://localhost/familiar_test', ASSET_DIR: '/private/tmp/familiar-config-test' }

it('requires private storage rather than silently starting without media routes', () => {
  expect(() => serverConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow('ASSET_DIR is required')
  expect(() => serverConfig({ ...valid, ASSET_DIR: 'public/assets' })).toThrow('ASSET_DIR must be an absolute private directory')
  expect(() => serverConfig({ ...valid, DATABASE_URL: '' })).toThrow('DATABASE_URL is required')
  expect(serverConfig(valid)).toEqual({ databaseUrl: valid.DATABASE_URL, assetDir: valid.ASSET_DIR, port: 3001 })
})

it.each(['', '0', '-1', '3001.5', '65536', 'invalid'])('rejects invalid configured port %s before listening', port => {
  expect(() => serverConfig({ ...valid, PORT: port })).toThrow('PORT must be an integer')
})
