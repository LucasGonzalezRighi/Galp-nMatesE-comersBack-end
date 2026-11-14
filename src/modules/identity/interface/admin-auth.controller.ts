import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  ApiCookieAuth,
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
  ADMIN_SESSION_COOKIE,
  clearedSessionCookie,
  sessionCookie,
} from '../../../shared/infrastructure/auth/cookies'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { validationProblem } from '../../../shared/infrastructure/http/validation.pipe'
import { AdminLoginCommand } from '../application/commands/admin-login.command'
import { ChangeAdminPasswordCommand } from '../application/commands/change-admin-password.command'
import { LogoutCommand } from '../application/commands/logout.command'
import {
  type AdminSessionView,
  GetAdminSessionQuery,
} from '../application/queries/get-admin-session.query'
import { AdminLoginDto } from './dto/admin-login.dto'
import { AdminPasswordChangeDto } from './dto/admin-password-change.dto'
import { IDENTITY_MESSAGES } from './dto/identity-fields'
import { AdminLoginResultDto, AdminSessionDto, CsrfTokenDto } from './dto/identity.response.dto'
import {
  adminUserIdOf,
  AUTH_WRITE_THROTTLE,
  clientIpOf,
  type CookieResponse,
  type CsrfTokenView,
} from './identity-http'

/** Sesión del dashboard recién iniciada (`AdminLoginResult` del contrato). */
export interface AdminLoginResultView extends AdminSessionView {
  /** Token anti-CSRF de la sesión nueva. */
  csrfToken: string
}

/** Error de la contraseña actual incorrecta (como el mock del front). */
const WRONG_CURRENT_PASSWORD = {
  field: 'currentPassword',
  code: 'invalid_password',
  message: 'La contraseña actual no es correcta',
} as const

/** Error de la confirmación distinta de la contraseña nueva (`refine` del schema del front). */
const PASSWORD_MISMATCH = {
  field: 'confirmation',
  code: 'custom',
  message: IDENTITY_MESSAGES.passwordMismatch,
} as const

/** Seguridad de las escrituras del dashboard: sesión del admin y su token CSRF, juntos. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/**
 * Sesión del dashboard (`/admin/auth`): inicio y cierre de sesión, la sesión activa, su CSRF y el
 * cambio de contraseña. El inicio de sesión no pide CSRF (no hay sesión todavía) y tiene un
 * límite de 20 por minuto por IP; las escrituras con sesión exigen el CSRF del admin.
 */
@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  /**
   * @param adminLogin - Inicio de sesión del admin.
   * @param logout - Cierre de sesión.
   * @param getSession - Sesión activa (email y vencimiento).
   * @param changePassword - Cambio de contraseña.
   */
  constructor(
    private readonly adminLogin: AdminLoginCommand,
    private readonly logout: LogoutCommand,
    private readonly getSession: GetAdminSessionQuery,
    private readonly changePassword: ChangeAdminPasswordCommand,
  ) {}

  /**
   * Inicia la sesión del admin: la cookie de 8 h viaja en `Set-Cookie` y el CSRF en el cuerpo.
   *
   * @param body - Email y contraseña.
   * @param ip - IP del cliente (el bloqueo por intentos cuenta por email y por IP).
   * @param res - Respuesta (para la cookie).
   * @returns Email, token CSRF y vencimiento.
   * @throws {InvalidCredentialsError} 401 `invalid_credentials`.
   * @throws {LoginLockedError} 429 `rate_limited`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_WRITE_THROTTLE)
  @ApiOperation({ operationId: 'adminLogin', summary: 'Iniciar sesión en el dashboard' })
  @ApiOkResponse({ type: AdminLoginResultDto, description: 'Sesión iniciada.' })
  @ApiProblemResponses(401, 422, 429, 500)
  async login(
    @Body() body: AdminLoginDto,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<AdminLoginResultView> {
    const { email, session } = await this.adminLogin.execute({
      email: body.email,
      password: body.password,
      clientIp: clientIpOf(ip),
    })
    res.setHeader(
      'Set-Cookie',
      sessionCookie(ADMIN_SESSION_COOKIE, session.id, SESSION_TTL_SECONDS.admin),
    )
    return { email, csrfToken: session.csrfToken, expiresAt: session.expiresAt }
  }

  /**
   * Cierra la sesión del admin y borra la cookie.
   *
   * @param session - Sesión del admin.
   * @param res - Respuesta (para borrar la cookie).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'adminLogout', summary: 'Cerrar sesión en el dashboard' })
  @ApiNoContentResponse({ description: 'Sesión cerrada.' })
  @ApiProblemResponses(401, 403, 429, 500)
  async logoutAdmin(
    @CurrentSession() session: SessionRecord,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    await this.logout.execute(session.id)
    res.setHeader('Set-Cookie', clearedSessionCookie(ADMIN_SESSION_COOKIE))
  }

  /**
   * Devuelve la sesión activa: el email del admin y cuándo vence.
   *
   * @param session - Sesión del admin.
   * @returns La sesión (`AdminSession` del contrato).
   */
  @Get('me')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminSession', summary: 'Obtener la sesión del dashboard' })
  @ApiOkResponse({ type: AdminSessionDto, description: 'Sesión activa.' })
  @ApiProblemResponses(401, 429, 500)
  me(@CurrentSession() session: SessionRecord): Promise<AdminSessionView> {
    return this.getSession.execute(session)
  }

  /**
   * Devuelve otra vez el CSRF de la sesión del admin (por ejemplo, después de recargar).
   *
   * @param session - Sesión del admin.
   * @returns El token CSRF.
   */
  @Get('csrf')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({
    operationId: 'getAdminCsrfToken',
    summary: 'Obtener el token anti-CSRF del dashboard',
  })
  @ApiOkResponse({ type: CsrfTokenDto, description: 'Token anti-CSRF.' })
  @ApiProblemResponses(401, 429, 500)
  csrf(@CurrentSession() session: SessionRecord): CsrfTokenView {
    return { csrfToken: session.csrfToken }
  }

  /**
   * Cambia la contraseña del admin: la sesión actual sigue valiendo (mismo CSRF) y las otras
   * sesiones del admin se cierran.
   *
   * @param body - Contraseña actual, nueva y su confirmación.
   * @param session - Sesión del admin.
   * @throws {UnprocessableEntityException} 422 en `confirmation` si no coincide con la nueva, o
   *   en `currentPassword` si la actual no es correcta.
   */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'changeAdminPassword',
    summary: 'Cambiar la contraseña del administrador',
  })
  @ApiNoContentResponse({ description: 'Contraseña cambiada.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  async password(
    @Body() body: AdminPasswordChangeDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<void> {
    if (body.confirmation !== body.newPassword) {
      throw validationProblem([{ ...PASSWORD_MISMATCH }])
    }
    const result = await this.changePassword.execute(
      adminUserIdOf(session),
      { currentPassword: body.currentPassword, newPassword: body.newPassword },
      session.id,
    )
    if (!result.ok) throw validationProblem([{ ...WRONG_CURRENT_PASSWORD }])
  }
}
