import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type LoggerService,
  ServiceUnavailableException,
} from '@nestjs/common'

import { DomainError } from '../../domain/domain-error'

/** `Content-Type` de todas las respuestas de error (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

/** Error de validación de un campo (`FieldError` del contrato). */
export interface FieldError {
  /** Ruta del campo con puntos, por ejemplo `customer.email`. */
  field: string
  /** Código estable en `snake_case`, por ejemplo `too_small`. */
  code: string
  /** Mensaje en español para mostrarle a la persona. */
  message: string
}

/** Cuerpo `application/problem+json` (`Problem` del contrato). */
export interface Problem {
  /** Identificador estable del error, en `snake_case` (por ejemplo `not_found`). */
  type: string
  /** Resumen corto en español. */
  title: string
  /** Código HTTP. */
  status: number
  /** Explicación de esta ocurrencia, en español. */
  detail?: string
  /** Ruta que falló (sin la query string). */
  instance?: string
  /** Errores por campo; solo en los 422. */
  errors?: FieldError[]
}

/**
 * Cuerpo propio que una `HttpException` puede llevar para elegir el `type` del `Problem`
 * (por ejemplo `new ConflictException({ type: 'slug_taken', detail: '…' })`). Lo que falte lo
 * completa el filtro con los valores del código HTTP.
 */
export interface ProblemBody {
  /** Identificador en `snake_case`. */
  type: string
  /** Resumen corto en español. */
  title?: string
  /** Explicación en español. */
  detail?: string
  /** Errores por campo (solo se mandan en los 422). */
  errors?: FieldError[]
}

/** Lo que el filtro rescata del cuerpo de una `HttpException`. */
interface ParsedBody {
  type?: string | undefined
  title?: string | undefined
  detail?: string | undefined
  errors?: FieldError[] | undefined
}

/** Valores por defecto de un código HTTP. */
interface StatusDefaults {
  type: string
  title: string
  detail: string
}

const SERVER_ERROR: StatusDefaults = {
  type: 'server_error',
  title: 'Error del servidor',
  detail: 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.',
}

const CLIENT_ERROR: StatusDefaults = {
  type: 'bad_request',
  title: 'Pedido inválido',
  detail: 'El pedido no se pudo procesar: revisá los datos enviados.',
}

/** `type`, `title` y `detail` por código HTTP, con los textos del contrato. */
const STATUS_DEFAULTS: ReadonlyMap<number, StatusDefaults> = new Map([
  [400, CLIENT_ERROR],
  [
    401,
    { type: 'unauthorized', title: 'Sesión requerida', detail: 'Iniciá sesión para continuar.' },
  ],
  [
    403,
    { type: 'forbidden', title: 'Acceso denegado', detail: 'No tenés permiso para hacer esto.' },
  ],
  [404, { type: 'not_found', title: 'No encontrado', detail: 'No encontramos lo que buscabas.' }],
  [
    405,
    {
      type: 'method_not_allowed',
      title: 'Método no permitido',
      detail: 'Esta ruta no acepta ese método.',
    },
  ],
  [
    409,
    {
      type: 'conflict',
      title: 'Conflicto',
      detail: 'La operación choca con el estado actual.',
    },
  ],
  [
    413,
    {
      type: 'payload_too_large',
      title: 'Pedido demasiado grande',
      detail: 'El cuerpo del pedido es demasiado grande.',
    },
  ],
  [
    415,
    {
      type: 'unsupported_media_type',
      title: 'Formato no soportado',
      detail: 'El formato del cuerpo del pedido no es soportado.',
    },
  ],
  [
    422,
    {
      type: 'validation_error',
      title: 'Los datos no son válidos',
      detail: 'Revisá los campos marcados.',
    },
  ],
  [
    429,
    {
      type: 'rate_limited',
      title: 'Demasiadas solicitudes',
      detail: 'Esperá unos segundos y volvé a intentar.',
    },
  ],
  [500, SERVER_ERROR],
  [
    503,
    {
      type: 'service_unavailable',
      title: 'Servicio no disponible',
      detail: 'El servicio no está disponible en este momento. Probá de nuevo en un rato.',
    },
  ],
])

/**
 * Valores por defecto (`type`, `title`, `detail`) de un código HTTP de error.
 *
 * @param status - Código HTTP.
 * @returns Los del código si los hay; si no, los genéricos de 4xx o de 5xx.
 */
export function problemDefaults(status: number): StatusDefaults {
  return STATUS_DEFAULTS.get(status) ?? (status >= 500 ? SERVER_ERROR : CLIENT_ERROR)
}

/** Lo que el filtro lee del pedido. */
interface ProblemRequest {
  method: string
  originalUrl: string
}

/** Lo que el filtro usa de la respuesta (la de Express lo cumple). */
interface ProblemResponse {
  headersSent?: boolean
  status(code: number): unknown
  setHeader(name: string, value: string): unknown
  json(body: unknown): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFieldErrors(value: unknown): value is FieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.field === 'string' &&
        typeof item.code === 'string' &&
        typeof item.message === 'string',
    )
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * El 503 de `@nestjs/terminus` (`/health` con Postgres caído) trae su propio informe
 * (`{ status: 'error', info, error, details }`): sale tal cual, porque `/health` no está en el
 * contrato y las sondas leen ese formato. No se loguea: la sonda lo pide a cada rato.
 */
function healthReport(exception: unknown): Record<string, unknown> | undefined {
  if (!(exception instanceof ServiceUnavailableException)) return undefined
  const response = exception.getResponse()
  return isRecord(response) && response.status === 'error' && isRecord(response.details)
    ? response
    : undefined
}

/**
 * Filtro global: toda excepción sale como `application/problem+json` con la forma `Problem` del
 * contrato (`type` en `snake_case`, `title`, `status`, `detail`, `instance` y, solo en los 422,
 * `errors`).
 *
 * - `DomainError` → su `code`, `status` y `detail`.
 * - `HttpException` de Nest (incluidos el 429 del throttler y el 404 de una ruta que no existe)
 *   → el `type` y el `title` del código HTTP, y su mensaje en `detail` cuando es propio. Si el
 *   cuerpo trae `type` (ver {@link ProblemBody}), se respeta.
 * - Cualquier otro error → 500 con un `detail` genérico (sin filtrar datos internos) y log
 *   `error` con el stack.
 *
 * Única excepción: el informe 503 de Terminus en `/health`, que sale con su formato.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  /**
   * @param logger - Destino de los logs de los 5xx; por defecto, el `Logger` de Nest (pino en la
   *   app).
   */
  constructor(
    private readonly logger: Pick<LoggerService, 'error'> = new Logger(ProblemFilter.name),
  ) {}

  /**
   * Responde la excepción como `problem+json`.
   *
   * @param exception - Lo que se lanzó.
   * @param host - Contexto de Nest; solo se atiende HTTP.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const req = http.getRequest<ProblemRequest>()
    const res = http.getResponse<ProblemResponse>()
    const report = healthReport(exception)
    if (report !== undefined) {
      if (res.headersSent === true) return
      res.status(HttpStatus.SERVICE_UNAVAILABLE)
      res.json(report)
      return
    }
    const problem = this.toProblem(exception, req)
    if (res.headersSent === true) return
    res.status(problem.status)
    res.setHeader('Content-Type', PROBLEM_CONTENT_TYPE)
    res.json(problem)
  }

  private toProblem(exception: unknown, req: ProblemRequest): Problem {
    const instance = req.originalUrl.split('?')[0] ?? req.originalUrl
    if (exception instanceof DomainError) {
      const defaults = problemDefaults(exception.status)
      return {
        type: exception.code,
        title: exception.title ?? defaults.title,
        status: exception.status,
        detail: exception.detail,
        instance,
      }
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      if (status >= 500) this.logError(exception, req, instance)
      return this.fromHttpException(exception, status, req, instance)
    }
    this.logError(exception, req, instance)
    return { ...SERVER_ERROR, status: 500, instance }
  }

  private fromHttpException(
    exception: HttpException,
    status: number,
    req: ProblemRequest,
    instance: string,
  ): Problem {
    const defaults = problemDefaults(status)
    const response = exception.getResponse()
    let body: ParsedBody = {}
    if (typeof response === 'string') {
      body = { detail: response }
    } else if (isRecord(response) && typeof response.type === 'string') {
      body = {
        type: response.type,
        title: optionalString(response.title),
        detail: optionalString(response.detail),
        errors: isFieldErrors(response.errors) ? response.errors : undefined,
      }
    } else if (isRecord(response) && ('error' in response || !('statusCode' in response))) {
      // `new NotFoundException('…')` trae `error`; `new NotFoundException()` solo el texto en
      // inglés del código, que no se muestra.
      body = { detail: optionalString(response.message) }
    }

    let detail = body.detail ?? defaults.detail
    if (status === 404 && detail === `Cannot ${req.method} ${req.originalUrl}`) {
      detail = `No existe la ruta ${req.method} ${instance}.`
    }
    const problem: Problem = {
      type: body.type ?? defaults.type,
      title: body.title ?? defaults.title,
      status,
      detail,
      instance,
    }
    if (status === 422 && body.errors !== undefined) problem.errors = body.errors
    return problem
  }

  private logError(exception: unknown, req: ProblemRequest, instance: string): void {
    const message = exception instanceof Error ? exception.message : String(exception)
    const stack = exception instanceof Error ? exception.stack : undefined
    this.logger.error(`${req.method} ${instance}: ${message}`, stack)
  }
}
