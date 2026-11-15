import type { Clock } from '../../../../shared/domain/clock'
import type { JsonObject, JsonValue } from '../../../../shared/domain/domain-event'
import { InvalidSignatureError } from '../../domain/payments-errors'
import {
  constantTimeEqual,
  isFreshSignature,
  signatureManifest,
} from '../../domain/webhook-signature'
import type { PaymentsSettings } from '../ports/payments-settings.port'
import type { WebhookEventRepository } from '../ports/webhook-event.repository.port'
import type { WebhookQueuePort } from '../ports/webhook-queue.port'
import type { ProcessWebhookEventCommand } from './process-webhook-event.command'

/** HMAC-SHA256 en hex; lo pone la infraestructura (`application` no importa `node:crypto`). */
export type HmacSha256 = (secret: string, manifest: string) => string

/** Lo que llega en `POST /webhooks/mercadopago`. */
export interface IncomingWebhook {
  /** Cabecera `x-signature`, o `null`. */
  signatureHeader: string | null
  /** Cabecera `x-request-id`, o `null`. */
  requestId: string | null
  /** Query `data.id`, o `null`. */
  dataIdQuery: string | null
  /** Query `topic` (formato IPN), o `null`. */
  topicQuery: string | null
  /** Cuerpo JSON. */
  body: unknown
}

/**
 * Resultado: `registered` (nuevo), `duplicate` (ya estaba; si no se había procesado, se vuelve a
 * encolar o a procesar) o `ignored` (IPN o cuerpo sin datos).
 */
export type WebhookOutcome = 'registered' | 'duplicate' | 'ignored'

interface ParsedBody {
  type: string
  action: string | null
  dataId: string
  payload: JsonObject
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(isJsonValue)
}

function idOf(value: JsonValue | undefined): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function filled(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim()
}

function parseBody(body: unknown): ParsedBody | null {
  if (!isJsonObject(body)) return null
  const { type, action, data } = body
  const dataId = isJsonObject(data) ? idOf(data.id) : null
  if (typeof type !== 'string' || type.trim() === '' || dataId === null) return null
  return {
    type: type.trim(),
    action: typeof action === 'string' ? action : null,
    dataId,
    payload: body,
  }
}

/**
 * `POST /webhooks/mercadopago` (Rulings B-37 y B-38): el formato IPN se ignora; si no, valida
 * `x-signature` (HMAC-SHA256 sobre el manifiesto, en tiempo constante; sin secreto, 401 siempre) y
 * que su `ts` esté a 5 minutos o menos del reloj (NV-05: una tupla vista no se repite para
 * siempre), registra la notificación una sola vez y la encola; si la cola no la acepta, la procesa
 * en línea. La clave de deduplicación (`event_id`) es el manifiesto firmado
 * (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`): el `id` del cuerpo no está firmado, así que
 * quien repite la tupla no puede elegir una clave nueva (ni, sin `data.id` en la query, otro pago).
 * Un duplicado de una notificación que quedó sin procesar (la cola y el procesado en línea fallaron
 * y Mercado Pago reintenta) se vuelve a encolar o a procesar, así no se pierde.
 */
export class ReceiveWebhookCommand {
  /**
   * @param settings - Secreto de webhooks.
   * @param hmac - HMAC-SHA256 en hex (infraestructura).
   * @param events - Notificaciones.
   * @param queue - Cola `payment-webhooks`.
   * @param process - Procesado en línea si la cola falla.
   * @param clock - Reloj.
   */
  constructor(
    private readonly settings: PaymentsSettings,
    private readonly hmac: HmacSha256,
    private readonly events: WebhookEventRepository,
    private readonly queue: WebhookQueuePort,
    private readonly process: Pick<ProcessWebhookEventCommand, 'execute'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @param input - Cabeceras, query y cuerpo.
   * @returns `registered`, `duplicate` o `ignored` (todos responden 200).
   * @throws {InvalidSignatureError} 401 si la firma falta, no coincide, no hay secreto o su `ts` está
   *   a más de 5 minutos del reloj.
   * @throws {Error} Si la notificación (nueva o duplicada sin procesar) no se pudo ni encolar ni
   *   procesar en línea: responde 500 y Mercado Pago reintenta.
   */
  async execute(input: IncomingWebhook): Promise<WebhookOutcome> {
    if (input.topicQuery !== null && input.signatureHeader === null) return 'ignored'
    const signed = signatureManifest({
      signatureHeader: input.signatureHeader,
      requestId: input.requestId,
      dataId: input.dataIdQuery,
    })
    const secret = this.settings.webhookSecret
    if (signed === null || secret === null || secret === '') throw new InvalidSignatureError()
    if (!constantTimeEqual(this.hmac(secret, signed.manifest), signed.v1)) {
      throw new InvalidSignatureError()
    }
    if (!isFreshSignature(signed.ts, this.clock.now())) throw new InvalidSignatureError()
    const body = parseBody(input.body)
    if (body === null) return 'ignored'
    const recorded = await this.events.record({
      provider: 'mercadopago',
      eventId: signed.manifest,
      type: body.type,
      action: body.action,
      resourceId: filled(input.dataIdQuery) ?? body.dataId,
      signatureValid: true,
      payload: body.payload,
      receivedAt: this.clock.now(),
    })
    if (recorded.duplicate) {
      const stored = await this.events.findById(recorded.id)
      if (stored?.processedAt === null) await this.dispatch(recorded.id)
      return 'duplicate'
    }
    await this.dispatch(recorded.id)
    return 'registered'
  }

  /** Encola el procesado (el `jobId` es el id de la fila, así que no se duplica) o lo hace en línea. */
  private async dispatch(eventId: string): Promise<void> {
    if (!(await this.queue.enqueue(eventId))) await this.process.execute(eventId)
  }
}
