import type { WorkerHost } from '@nestjs/bullmq'
import type { Queue, Worker } from 'bullmq'

/** Cuánto espera el cierre de un worker a que Redis conteste antes de cerrarlo forzado. */
export const WORKER_SHUTDOWN_PROBE_MS = 1_000

/**
 * Indica si Redis contesta a tiempo (las colas no encolan offline: con Redis caído fallan al
 * toque). Lo usan los workers al cerrar.
 *
 * @param queue - Cola a sondear.
 * @returns `true` si `getJobCounts` contesta en {@link WORKER_SHUTDOWN_PROBE_MS}.
 */
export async function redisAnswers(queue: Pick<Queue, 'getJobCounts'>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false)
    }, WORKER_SHUTDOWN_PROBE_MS)
  })
  const probe = queue.getJobCounts('waiting').then(
    () => true,
    () => false,
  )
  try {
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cierra el worker de un processor antes que el resto de la app: con Redis caído el cierre normal
 * de BullMQ espera para siempre a que termine el bucle del worker (y `app.close()` queda colgado),
 * así que si Redis no contesta en {@link WORKER_SHUTDOWN_PROBE_MS} lo cierra forzado (el job en
 * curso, si lo hay, queda estancado y se reintenta). Sin `app.init()` no hay worker y no hace
 * nada.
 *
 * @param host - Processor (su `worker` lanza si todavía no existe).
 * @param queue - Cola del processor, para sondear Redis.
 */
export async function closeWorker(
  host: WorkerHost,
  queue: Pick<Queue, 'getJobCounts'>,
): Promise<void> {
  let worker: Worker
  try {
    worker = host.worker
  } catch {
    return
  }
  await worker.close(!(await redisAnswers(queue)))
}
