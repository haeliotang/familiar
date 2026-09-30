import type { FastifyInstance } from 'fastify'

export function registerShutdown(app: FastifyInstance) {
  let closing = false
  async function stop() {
    if (closing) return
    closing = true
    try {
      await app.close()
      process.exit(0)
    } catch (error) {
      app.log.error(error)
      process.exit(1)
    }
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  app.addHook('onClose', async () => {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  })
}
