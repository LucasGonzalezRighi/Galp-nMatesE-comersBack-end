import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import {
  SESSION_TTL_SECONDS,
  type SessionRecord,
} from '../../../shared/application/ports/session.port'
import {
  clearedSessionCookie,
  type CookieRequest,
  CUSTOMER_SESSION_COOKIE,
  readSessionCookie,
  sessionCookie,
} from '../../../shared/infrastructure/auth/cookies'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import {
  CustomerCsrfGuard,
  CustomerSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { validationProblem } from '../../../shared/infrastructure/http/validation.pipe'
import { IssueCsrfTokenCommand } from '../application/commands/issue-csrf-token.command'
import { LoginCustomerCommand } from '../application/commands/login-customer.command'
import { LogoutCommand } from '../application/commands/logout.command'
import {
  type CustomerSessionResult,
  RegisterCustomerCommand,
} from '../application/commands/register-customer.command'
import { RequestPasswordResetCommand } from '../application/commands/request-password-reset.command'
import { ResetPasswordCommand } from '../application/commands/reset-password.command'
import type { CustomerView } from '../application/read-models'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { CsrfTokenDto, CustomerDto } from './dto/identity.response.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import {
  AUTH_WRITE_THROTTLE,
  clientIpOf,
  type CookieResponse,
  type CsrfTokenView,
} from './identity-http'

/** Error del campo `token` cuando el enlace de recuperación no sirve (como el mock del front). */
const INVALID_RESET_TOKEN = {
  field: 'token',
  code: 'invalid_token',
  message: 'El enlace para cambiar la contraseña no es válido o ya venció.',
} as const

/**
 * Sesión de la tienda (`/auth`): token CSRF, registro, inicio y cierre de sesión, y recuperación
 * de la contraseña. Las escrituras exigen el CSRF de la sesión actual (anónima o de cliente);
 * registro, inicio de sesión y recuperación tienen además un límite de 20 por minuto por IP.
 */
@ApiTags('account')
@Controller('auth')
export class AuthController {
  /**
   * @param issueCsrf - Token CSRF de la sesión actual (o de una anónima nueva).
   * @param registerCustomer - Alta de cuenta.
   * @param loginCustomer - Inicio de sesión.
   * @param logout - Cierre de sesión.
   * @param requestPasswordReset - Pedido del mail de recuperación.
   * @param resetPassword - Cambio de contraseña con el token del mail.
   */
  constructor(
    private readonly issueCsrf: IssueCsrfTokenCommand,
    private readonly registerCustomer: RegisterCustomerCommand,
    private readonly loginCustomer: LoginCustomerCommand,
    private readonly logout: LogoutCommand,
    private readonly requestPasswordReset: RequestPasswordResetCommand,
    private readonly resetPassword: ResetPasswordCommand,
  ) {}

  /**
   * Devuelve el CSRF de la sesión de la cookie (anónima o de cliente); si no hay una vigente,
   * abre una anónima de 30 minutos y manda su cookie.
   *
   * @param req - Pedido (se lee la cookie `__Host-galpon_session`).
   * @param res - Respuesta (para la cookie de la sesión nueva).
   * @returns El token CSRF.
   */
  @Get('csrf')
  @ApiOperation({
    operationId: 'getCustomerCsrfToken',
    summary: 'Obtener el token anti-CSRF del cliente',
  })
  @ApiOkResponse({ type: CsrfTokenDto, description: 'Token anti-CSRF.' })
  @ApiProblemResponses(429, 500)
  async csrf(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<CsrfTokenView> {
    const current = readSessionCookie(req, CUSTOMER_SESSION_COOKIE)
    const { session, created } = await this.issueCsrf.execute(current)
    if (created) {
      res.setHeader(
        'Set-Cookie',
        sessionCookie(CUSTOMER_SESSION_COOKIE, session.id, SESSION_TTL_SECONDS.anonymous),
      )
    }
    return { csrfToken: session.csrfToken }
  }

  /**
   * Crea la cuenta e inicia la sesión: la sesión actual se cierra (su CSRF deja de valer) y la
   * nueva viaja en la cookie de 30 días.
   *
   * @param body - Email, nombre, apellido y contraseña ya validados y normalizados.
   * @param current - Sesión actual (la que dio el CSRF).
   * @param res - Respuesta (para la cookie).
   * @returns Los datos del cliente.
   * @throws {EmailAlreadyRegisteredError} 409 si el email ya tiene cuenta.
   */
  @Post('register')
  @UseGuards(CustomerCsrfGuard)
  @Throttle(AUTH_WRITE_THROTTLE)
  @ApiSecurity('csrfToken')
  @ApiOperation({ operationId: 'registerCustomer', summary: 'Crear una cuenta' })
  @ApiCreatedResponse({ type: CustomerDto, description: 'Cuenta creada y sesión iniciada.' })
  @ApiProblemResponses(403, 409, 422, 429, 500)
  async register(
    @Body() body: RegisterDto,
    @CurrentSession() current: SessionRecord,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<CustomerView> {
    const { email, firstName, lastName, password } = body
    const result = await this.registerCustomer.execute(
      { email, firstName, lastName, password },
      current.id,
    )
    return startCustomerSession(res, result)
  }

  /**
   * Inicia la sesión del cliente (rota la sesión actual). Email o contraseña incorrectos → 401
   * sin decir cuál; 10 intentos del mismo email desde la misma IP en 15 minutos → el siguiente,
   * 429 con `Retry-After` (el décimo también, si falla).
   *
   * @param body - Email y contraseña.
   * @param current - Sesión actual (la que dio el CSRF).
   * @param ip - IP del cliente (el bloqueo por intentos cuenta por email y por IP).
   * @param res - Respuesta (para la cookie).
   * @returns Los datos del cliente.
   * @throws {InvalidCredentialsError} 401 `invalid_credentials`.
   * @throws {LoginLockedError} 429 `rate_limited`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerCsrfGuard)
  @Throttle(AUTH_WRITE_THROTTLE)
  @ApiSecurity('csrfToken')
  @ApiOperation({ operationId: 'loginCustomer', summary: 'Iniciar sesión' })
  @ApiOkResponse({ type: CustomerDto, description: 'Sesión iniciada.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  async login(
    @Body() body: LoginDto,
    @CurrentSession() current: SessionRecord,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<CustomerView> {
    const { email, password } = body
    const result = await this.loginCustomer.execute(
      { email, password, clientIp: clientIpOf(ip) },
      current.id,
    )
    return startCustomerSession(res, result)
  }

  /**
   * Cierra la sesión del cliente y borra la cookie.
   *
   * @param session - Sesión del cliente.
   * @param res - Respuesta (para borrar la cookie).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  @ApiSecurity({ customerSession: [], csrfToken: [] })
  @ApiOperation({ operationId: 'logoutCustomer', summary: 'Cerrar sesión' })
  @ApiNoContentResponse({ description: 'Sesión cerrada.' })
  @ApiProblemResponses(401, 403, 429, 500)
  async logoutCustomer(
    @CurrentSession() session: SessionRecord,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    await this.logout.execute(session.id)
    res.setHeader('Set-Cookie', clearedSessionCookie(CUSTOMER_SESSION_COOKIE))
  }

  /**
   * Pide el mail para elegir una contraseña nueva. Responde 202 siempre, exista la cuenta o no.
   *
   * @param body - Email de la cuenta.
   */
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CustomerCsrfGuard)
  @Throttle(AUTH_WRITE_THROTTLE)
  @ApiSecurity('csrfToken')
  @ApiOperation({ operationId: 'requestPasswordReset', summary: 'Pedir el cambio de contraseña' })
  @ApiAcceptedResponse({ description: 'Pedido recibido.' })
  @ApiProblemResponses(403, 422, 429, 500)
  async forgot(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.requestPasswordReset.execute(body.email)
  }

  /**
   * Cambia la contraseña con el token del mail (de un solo uso) y cierra todas las sesiones de
   * la cuenta.
   *
   * @param body - Token y contraseña nueva.
   * @throws {UnprocessableEntityException} 422 en `token` si no existe, venció o ya se usó.
   */
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerCsrfGuard)
  @Throttle(AUTH_WRITE_THROTTLE)
  @ApiSecurity('csrfToken')
  @ApiOperation({ operationId: 'resetPassword', summary: 'Elegir una contraseña nueva' })
  @ApiNoContentResponse({ description: 'Contraseña cambiada.' })
  @ApiProblemResponses(403, 422, 429, 500)
  async reset(@Body() body: ResetPasswordDto): Promise<void> {
    const result = await this.resetPassword.execute({ token: body.token, password: body.password })
    if (!result.ok) throw validationProblem([{ ...INVALID_RESET_TOKEN }])
  }
}

/** Manda la cookie de la sesión de cliente nueva (30 días) y devuelve los datos del cliente. */
function startCustomerSession(res: CookieResponse, result: CustomerSessionResult): CustomerView {
  res.setHeader(
    'Set-Cookie',
    sessionCookie(CUSTOMER_SESSION_COOKIE, result.session.id, SESSION_TTL_SECONDS.customer),
  )
  return result.customer
}
