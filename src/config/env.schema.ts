import { z } from 'zod'

import { MAIL_PRODUCTION_LOG_MESSAGE, MAIL_SMTP_MISSING_MESSAGE } from './mail'
import { MEDIA_CLOUDINARY_MISSING_MESSAGE, MEDIA_PRODUCTION_SIMULATED_MESSAGE } from './media'

/** Configuración de la API, ya validada y con los valores por defecto aplicados. */
export interface Env {
  /**
   * Entorno de ejecución, obligatorio y explícito (NV-07): sin él la API no arranca, así un
   * despliegue que se olvida de definirlo no corre como desarrollo (Swagger, simulador de pagos,
   * links de recuperación en el log). En `test` el logger no escribe nada.
   */
  NODE_ENV: 'development' | 'test' | 'production'
  /**
   * Interfaz en la que escucha la API (NV-31): una IP o `localhost`. Por defecto `127.0.0.1` fuera
   * de producción (solo esta máquina) y `0.0.0.0` en producción (detrás del proxy o del contenedor).
   */
  HOST: string
  /** Puerto HTTP (por defecto 3001, donde la tienda y el admin esperan el back). */
  PORT: number
  /**
   * Proxies de confianza (NV-25): IPs o redes CIDR separadas por comas, o los nombres `loopback`,
   * `linklocal` y `uniquelocal` de Express. Vacía (por defecto) queda apagada: `req.ip` es la IP
   * del socket y todo lo que llega por el servidor de la tienda comparte sus contadores. Con la
   * lista, Express toma la IP del cliente de `X-Forwarded-For` saltando solo esos proxies, y los
   * límites por IP cuentan por la IP real. Solo hay que listar proxies que pongan la IP real del
   * cliente en `X-Forwarded-For` (si no, cualquiera puede inventarse una).
   */
  TRUST_PROXY: readonly string[]
  /**
   * Secreto compartido con la tienda y el dashboard cuando no hay IPs fijas que listar en
   * `TRUST_PROXY` (ellos en Vercel, el back en Render): el mismo `API_PROXY_SECRET` de la tienda,
   * de 32 caracteres o más. Un pedido que lo trae en `x-galpon-proxy-secret` viene de nuestros
   * proyectos, y la IP del cliente es la que mandan (`x-galpon-client-ip`, o la primera de
   * `X-Forwarded-For` con `x-galpon-client-ip-from: x-forwarded-for`); uno que no lo trae se cuenta
   * por la IP con la que llega. Sin él (por defecto) nada cambia. Nunca se loguea.
   */
  TRUSTED_PROXY_SECRET?: string | undefined
  /**
   * Cabecera donde el borde de la plataforma escribe la IP del visitante, pisando la que mande el
   * navegador (en minúsculas). En Render es `true-client-ip`: la pone Cloudflare, que está delante
   * de todos sus servicios. Con ella, un pedido que no trae el secreto compartido (el dashboard
   * llamando directo desde el navegador, o cualquiera que le pegue al back) cuenta por esa IP en los
   * límites, y no por la del proxy de Render. Lo que reenvía la tienda con el secreto manda sobre
   * esta cabecera. Sin ella (por defecto) nada cambia. Solo hay que ponerla si la plataforma
   * garantiza que el visitante no la puede inventar; nunca `x-forwarded-for` ni `forwarded`, a las
   * que Render les agrega al final lo que mande el visitante.
   */
  TRUSTED_CLIENT_IP_HEADER?: string | undefined
  /** Conexión a Postgres: `postgresql://usuario:clave@host:5432/base`. */
  DATABASE_URL: string
  /** Conexión a Redis: `redis://host:6379` (o `rediss://` con TLS). */
  REDIS_URL: string
  /**
   * Origen público del admin, el único con CORS y credenciales. Fuera de producción vale por
   * defecto `http://localhost:5173`; en `production` es obligatorio y explícito (B8): olvidarlo
   * habilitaría CORS con credenciales para `localhost`.
   */
  ADMIN_ORIGIN: string
  /**
   * Origen público de la tienda: arma los enlaces de los mails y la vuelta del pago. Fuera de
   * producción vale por defecto `http://localhost:3000`; en `production` es obligatorio y
   * explícito (B8).
   */
  STORE_ORIGIN: string
  /**
   * Origen por el que el back le habla a la tienda para el aviso de revalidación
   * (`POST /api/revalidate`), cuando conviene no salir por el origen público: en el compose de
   * producción, `http://store:3000` (la red interna de Docker). Si falta, se usa `STORE_ORIGIN`.
   */
  STORE_INTERNAL_ORIGIN?: string | undefined
  /**
   * Secreto de `POST ${STORE_ORIGIN}/api/revalidate` (cabecera `x-revalidate-secret`): el mismo
   * `REVALIDATE_SECRET` de la tienda, de 32 caracteres o más. Obligatorio en `production`; sin él
   * no se le avisa nada a la tienda, que se regenera por tiempo. Nunca se loguea.
   */
  STORE_REVALIDATE_SECRET?: string | undefined
  /** Nivel mínimo de log (por defecto `info`). */
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  /**
   * Pasarela de pagos (por defecto `simulated`): `simulated` usa el simulador del back (sin
   * credenciales; no se admite en `production`) y `live` habla con Mercado Pago.
   */
  MP_MODE: 'simulated' | 'live'
  /** Access token de Mercado Pago (de prueba o productivo, hoy los dos `APP_USR-…`). Obligatorio con `live`; nunca se loguea. */
  MP_ACCESS_TOKEN?: string | undefined
  /** Clave secreta de las notificaciones (firma `x-signature`). Obligatoria con `live`. */
  MP_WEBHOOK_SECRET?: string | undefined
  /**
   * Origen público HTTPS de este back, sin ruta (`https://api.ejemplo.com`): arma la
   * `notification_url` del webhook. Obligatorio con `live`; en `simulated`, si falta, el simulador
   * usa `http://localhost:${PORT}`.
   */
  PUBLIC_API_ORIGIN?: string | undefined
  /** Texto del resumen de la tarjeta (por defecto `GALPON MATES`, hasta 13 caracteres). */
  MP_STATEMENT_DESCRIPTOR: string
  /**
   * Fotos del dashboard (por defecto `simulated`): `simulated` firma como el mock y arma las `url`
   * con la nube `galpon-mock` (no se admite en `production`); `cloudinary` firma con las
   * credenciales de Cloudinary.
   */
  MEDIA_MODE: 'simulated' | 'cloudinary'
  /** Nube de Cloudinary (arma las `url` de las fotos). Obligatoria con `cloudinary`. */
  CLOUDINARY_CLOUD_NAME?: string | undefined
  /** API key de Cloudinary (va en la firma de las subidas). Obligatoria con `cloudinary`. */
  CLOUDINARY_API_KEY?: string | undefined
  /** API secret de Cloudinary (firma las subidas). Obligatorio con `cloudinary`; nunca se loguea. */
  CLOUDINARY_API_SECRET?: string | undefined
  /**
   * Envío de mails (por defecto `log`, LS-6): `log` no manda nada y deja en el log la plantilla y
   * el destinatario enmascarado (no se admite en `production`); `smtp` manda por el servidor SMTP
   * de `SMTP_HOST`.
   */
  MAIL_MODE: 'log' | 'smtp'
  /** Servidor SMTP. Obligatorio con `smtp`. */
  SMTP_HOST?: string | undefined
  /** Puerto del servidor SMTP (465 abre TLS directo; 587, STARTTLS). Obligatorio con `smtp`. */
  SMTP_PORT?: number | undefined
  /** Usuario del servidor SMTP. Obligatorio con `smtp`. */
  SMTP_USER?: string | undefined
  /** Contraseña del servidor SMTP. Obligatoria con `smtp`; nunca se loguea. */
  SMTP_PASS?: string | undefined
  /** Remitente de los mails (`Galpón Mates <hola@dominio.com>`). Obligatorio con `smtp`. */
  MAIL_FROM?: string | undefined
}

const HTTP_PROTOCOL = /^https?$/

/** Mensaje de `parseEnv` cuando `MP_MODE=live` y falta alguna credencial. */
export const MP_LIVE_MISSING_MESSAGE =
  'Con MP_MODE=live hacen falta MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET y PUBLIC_API_ORIGIN.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y `MP_MODE` no es `live`. */
export const MP_PRODUCTION_SIMULATED_MESSAGE = 'En producción MP_MODE tiene que ser live.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y falta `STORE_ORIGIN` o `ADMIN_ORIGIN`. */
export const ORIGINS_PRODUCTION_MESSAGE =
  'En producción hacen falta STORE_ORIGIN y ADMIN_ORIGIN (los orígenes públicos de la tienda y del dashboard).'

/** `ADMIN_ORIGIN` por defecto fuera de producción: el dashboard con `vite`. */
export const DEFAULT_ADMIN_ORIGIN = 'http://localhost:5173'

/** `STORE_ORIGIN` por defecto fuera de producción: la tienda con `next`. */
export const DEFAULT_STORE_ORIGIN = 'http://localhost:3000'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y falta `STORE_REVALIDATE_SECRET`. */
export const STORE_REVALIDATE_PRODUCTION_MESSAGE =
  'En producción hace falta STORE_REVALIDATE_SECRET (el mismo REVALIDATE_SECRET de la tienda).'

/**
 * `HOST` por defecto: todas las interfaces solo en producción; si no, solo esta máquina.
 *
 * @param nodeEnv - Entorno de ejecución.
 * @returns `0.0.0.0` en producción; `127.0.0.1` en desarrollo y en test.
 */
export function defaultHost(nodeEnv: Env['NODE_ENV']): string {
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1'
}

/** Nombres de redes que Express acepta en `trust proxy` además de IPs y CIDR. */
const TRUST_PROXY_NAMES = ['loopback', 'linklocal', 'uniquelocal'] as const

/** Un elemento de `TRUST_PROXY`: IP, red CIDR o nombre de red de Express. */
const trustedProxySchema = z.union([
  z.ipv4(),
  z.ipv6(),
  z.cidrv4(),
  z.cidrv6(),
  z.enum(TRUST_PROXY_NAMES),
])

/**
 * Separa `TRUST_PROXY` por comas, sin espacios ni elementos vacíos.
 *
 * @param value - La variable cruda (puede faltar).
 * @returns Los proxies de confianza; vacío si la variable falta o está vacía.
 */
export function splitTrustProxy(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * Cabeceras que no pueden ser `TRUSTED_CLIENT_IP_HEADER`: las tres propias del secreto compartido
 * (las borra `trustedProxyMiddleware`) y las de la cadena de proxies, que traen una lista y a las
 * que Render les agrega al final lo que mande el visitante en vez de pisarlo.
 */
const RESERVED_CLIENT_IP_HEADERS: readonly string[] = [
  'x-galpon-proxy-secret',
  'x-galpon-client-ip',
  'x-galpon-client-ip-from',
  'x-forwarded-for',
  'forwarded',
]

/** Nombre de una cabecera HTTP (un `token` de la RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

/** Esquema de `TRUSTED_CLIENT_IP_HEADER`: un nombre de cabecera permitido, en minúsculas. */
const clientIpHeaderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEADER_NAME)
  .refine((name) => !RESERVED_CLIENT_IP_HEADERS.includes(name))

/** Indica si `value` es un origen sin ruta, query ni barra final (`https://host[:puerto]`). */
function isBareOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value
}

/**
 * Esquema zod de las variables de entorno. Los nombres son los de `.env.example`; `PORT` llega
 * como texto y se convierte a número. `NODE_ENV` no tiene valor por defecto. Las reglas entre
 * variables (`MP_MODE=live` exige sus tres credenciales; `production` exige `live` y
 * `STORE_REVALIDATE_SECRET`) se revisan solo si cada variable es válida por sí sola; lo mismo
 * `MEDIA_MODE=cloudinary` con sus tres credenciales y `production` con `cloudinary`, y
 * `MAIL_MODE=smtp` con sus cinco variables y `production` con `smtp`. `production` exige además
 * `STORE_ORIGIN` y `ADMIN_ORIGIN` explícitas. Al final, `HOST` toma su valor por defecto según el
 * entorno ({@link defaultHost}) y, fuera de producción, los dos orígenes toman los de `localhost`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    HOST: z.union([z.ipv4(), z.ipv6(), z.literal('localhost')]).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    TRUST_PROXY: z.string().optional().transform(splitTrustProxy).pipe(z.array(trustedProxySchema)),
    TRUSTED_PROXY_SECRET: z.string().min(32).optional(),
    TRUSTED_CLIENT_IP_HEADER: clientIpHeaderSchema.optional(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    ADMIN_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).optional(),
    STORE_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).optional(),
    STORE_INTERNAL_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).optional(),
    STORE_REVALIDATE_SECRET: z.string().min(32).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MP_MODE: z.enum(['simulated', 'live']).default('simulated'),
    MP_ACCESS_TOKEN: z.string().min(1).optional(),
    MP_WEBHOOK_SECRET: z.string().min(1).optional(),
    PUBLIC_API_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).refine(isBareOrigin).optional(),
    MP_STATEMENT_DESCRIPTOR: z.string().min(1).max(13).default('GALPON MATES'),
    MEDIA_MODE: z.enum(['simulated', 'cloudinary']).default('simulated'),
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    MAIL_MODE: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z.string().trim().min(3).optional(),
  })
  .superRefine((env, ctx) => {
    // Reglas entre variables: sin `path`, `parseEnv` muestra el mensaje tal cual.
    const live = env.MP_MODE === 'live'
    if (live && (!env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET || !env.PUBLIC_API_ORIGIN)) {
      ctx.addIssue({ code: 'custom', message: MP_LIVE_MISSING_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && !live) {
      ctx.addIssue({ code: 'custom', message: MP_PRODUCTION_SIMULATED_MESSAGE, path: [] })
    }
    if (
      env.NODE_ENV === 'production' &&
      (env.STORE_ORIGIN === undefined || env.ADMIN_ORIGIN === undefined)
    ) {
      ctx.addIssue({ code: 'custom', message: ORIGINS_PRODUCTION_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && env.STORE_REVALIDATE_SECRET === undefined) {
      ctx.addIssue({ code: 'custom', message: STORE_REVALIDATE_PRODUCTION_MESSAGE, path: [] })
    }
    const cloudinary = env.MEDIA_MODE === 'cloudinary'
    if (
      cloudinary &&
      (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET)
    ) {
      ctx.addIssue({ code: 'custom', message: MEDIA_CLOUDINARY_MISSING_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && !cloudinary) {
      ctx.addIssue({ code: 'custom', message: MEDIA_PRODUCTION_SIMULATED_MESSAGE, path: [] })
    }
    const smtp = env.MAIL_MODE === 'smtp'
    if (
      smtp &&
      (!env.SMTP_HOST ||
        env.SMTP_PORT === undefined ||
        !env.SMTP_USER ||
        !env.SMTP_PASS ||
        !env.MAIL_FROM)
    ) {
      ctx.addIssue({ code: 'custom', message: MAIL_SMTP_MISSING_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && !smtp) {
      ctx.addIssue({ code: 'custom', message: MAIL_PRODUCTION_LOG_MESSAGE, path: [] })
    }
  })
  .transform(({ HOST, ADMIN_ORIGIN, STORE_ORIGIN, ...env }) => ({
    ...env,
    HOST: HOST ?? defaultHost(env.NODE_ENV),
    ADMIN_ORIGIN: ADMIN_ORIGIN ?? DEFAULT_ADMIN_ORIGIN,
    STORE_ORIGIN: STORE_ORIGIN ?? DEFAULT_STORE_ORIGIN,
  })) satisfies z.ZodType<Env>

/** Qué se espera en cada variable, para el mensaje de error de `parseEnv`. */
export const ENV_HINTS: Record<keyof Env, string> = {
  NODE_ENV:
    'development, test o production (sin NODE_ENV el back no arranca: tiene que decirse explícito)',
  HOST: 'una IP (por ejemplo 127.0.0.1 o 0.0.0.0) o localhost',
  PORT: 'un número entero entre 1 y 65535',
  TRUST_PROXY:
    'IPs o redes CIDR separadas por comas (por ejemplo 10.0.0.5,10.1.0.0/16), o loopback, linklocal o uniquelocal; vacía para apagarla',
  TRUSTED_PROXY_SECRET: 'el mismo API_PROXY_SECRET de la tienda, de 32 caracteres o más',
  TRUSTED_CLIENT_IP_HEADER:
    'el nombre de la cabecera con la IP del visitante (en Render, true-client-ip); ni x-forwarded-for, ni forwarded, ni las x-galpon-',
  DATABASE_URL: 'una URL de Postgres (postgresql://usuario:clave@host:5432/base)',
  REDIS_URL: 'una URL de Redis (redis://host:6379)',
  ADMIN_ORIGIN: 'una URL http o https (por ejemplo http://localhost:5173)',
  STORE_ORIGIN: 'una URL http o https (por ejemplo http://localhost:3000)',
  STORE_INTERNAL_ORIGIN: 'una URL http o https (por ejemplo http://store:3000)',
  STORE_REVALIDATE_SECRET: 'el mismo REVALIDATE_SECRET de la tienda, de 32 caracteres o más',
  LOG_LEVEL: 'debug, info, warn o error',
  MP_MODE: 'simulated o live',
  MP_ACCESS_TOKEN: 'el access token de Mercado Pago (no vacío)',
  MP_WEBHOOK_SECRET: 'la clave secreta de las notificaciones de Mercado Pago (no vacía)',
  PUBLIC_API_ORIGIN:
    'un origen http o https sin ruta ni barra final (por ejemplo https://api.ejemplo.com)',
  MP_STATEMENT_DESCRIPTOR: 'un texto de 1 a 13 caracteres (por ejemplo GALPON MATES)',
  MEDIA_MODE: 'simulated o cloudinary',
  CLOUDINARY_CLOUD_NAME: 'el nombre de la nube de Cloudinary (no vacío)',
  CLOUDINARY_API_KEY: 'la API key de Cloudinary (no vacía)',
  CLOUDINARY_API_SECRET: 'el API secret de Cloudinary (no vacío)',
  MAIL_MODE: 'log o smtp',
  SMTP_HOST: 'el servidor SMTP (por ejemplo smtp.ejemplo.com)',
  SMTP_PORT: 'un número entero entre 1 y 65535 (465 o 587)',
  SMTP_USER: 'el usuario del servidor SMTP (no vacío)',
  SMTP_PASS: 'la contraseña del servidor SMTP (no vacía)',
  MAIL_FROM: 'el remitente (por ejemplo Galpón Mates <hola@dominio.com>)',
}
