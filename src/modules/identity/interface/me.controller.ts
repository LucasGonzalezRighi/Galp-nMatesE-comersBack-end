import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import {
  CustomerCsrfGuard,
  CustomerSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import type { Page } from '../../../shared/infrastructure/http/page'
import { validationProblem } from '../../../shared/infrastructure/http/validation.pipe'
import { CreateMyAddressCommand } from '../application/commands/create-my-address.command'
import { DeleteMyAddressCommand } from '../application/commands/delete-my-address.command'
import { UpdateMeCommand } from '../application/commands/update-me.command'
import { UpdateMyAddressCommand } from '../application/commands/update-my-address.command'
import { GetMeQuery } from '../application/queries/get-me.query'
import { ListMyAddressesQuery } from '../application/queries/list-my-addresses.query'
import type { AddressView, CustomerView } from '../application/read-models'
import { AddressBookInputDto, AddressInputDto } from './dto/address-book-input.dto'
import { CustomerUpdateDto } from './dto/customer-update.dto'
import { CustomerDto, OrderSummaryPageDto } from './dto/identity.response.dto'
import { MY_ORDERS_PAGE_SIZE, MyOrdersQueryDto } from './dto/my-orders.query.dto'
import { customerIdOf } from './identity-http'

/** Error del `PATCH /me` sin ningún campo (como el mock del front). */
const EMPTY_UPDATE = {
  field: '',
  code: 'too_small',
  message: 'Mandá al menos un dato para cambiar.',
} as const

/** Parámetro `AddressId` del contrato: el id llega tal cual y uno que no existe responde 404. */
const ADDRESS_ID_PARAM = {
  name: 'id',
  description: 'Identificador de una dirección de la libreta del cliente.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/** Seguridad de las escrituras de la cuenta: sesión del cliente y su token CSRF, juntos. */
const SESSION_AND_CSRF = { customerSession: [], csrfToken: [] }

/**
 * Cuenta del cliente con la sesión iniciada (`/me`): sus datos, sus pedidos (vacío hasta B4) y su
 * libreta de direcciones. Las lecturas piden la sesión; las escrituras, además, su CSRF.
 */
@ApiTags('account')
@ApiExtraModels(AddressInputDto)
@Controller('me')
export class MeController {
  /**
   * @param getMe - Datos del cliente.
   * @param updateMe - Cambio de nombre, apellido o teléfono.
   * @param listAddresses - Libreta de direcciones.
   * @param createAddress - Alta de una dirección.
   * @param updateAddress - Reemplazo de una dirección.
   * @param deleteAddress - Baja de una dirección.
   */
  constructor(
    private readonly getMe: GetMeQuery,
    private readonly updateMe: UpdateMeCommand,
    private readonly listAddresses: ListMyAddressesQuery,
    private readonly createAddress: CreateMyAddressCommand,
    private readonly updateAddress: UpdateMyAddressCommand,
    private readonly deleteAddress: DeleteMyAddressCommand,
  ) {}

  /**
   * Devuelve los datos del cliente con la sesión iniciada.
   *
   * @param session - Sesión del cliente.
   * @returns Email, nombre, apellido y teléfono.
   */
  @Get()
  @UseGuards(CustomerSessionGuard)
  @ApiCookieAuth('customerSession')
  @ApiOperation({ operationId: 'getMe', summary: 'Obtener mis datos' })
  @ApiOkResponse({ type: CustomerDto, description: 'Datos del cliente.' })
  @ApiProblemResponses(401, 429, 500)
  me(@CurrentSession() session: SessionRecord): Promise<CustomerView> {
    return this.getMe.execute(session)
  }

  /**
   * Cambia el nombre, el apellido o el teléfono (`phone: null` lo borra); el resto queda igual.
   *
   * @param body - Cambios ya validados.
   * @param session - Sesión del cliente.
   * @returns Los datos actualizados.
   * @throws {UnprocessableEntityException} 422 sin campo si el cuerpo no trae ningún cambio.
   */
  @Patch()
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateMe', summary: 'Actualizar mis datos' })
  @ApiBody({ required: true, schema: schemaRef('CustomerUpdate') })
  @ApiOkResponse({ type: CustomerDto, description: 'Datos actualizados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  update(
    @Body() body: CustomerUpdateDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<CustomerView> {
    if (body.isEmpty()) throw validationProblem([{ ...EMPTY_UPDATE }])
    return this.updateMe.execute(customerIdOf(session), body.toPatch())
  }

  /**
   * Lista los pedidos del cliente de a 10. Hasta B4 (pedidos) la lista está vacía.
   *
   * @param query - Página pedida, ya validada.
   * @returns La página (`OrderSummaryPage` del contrato).
   */
  @Get('orders')
  @UseGuards(CustomerSessionGuard)
  @ApiCookieAuth('customerSession')
  @ApiOperation({ operationId: 'listMyOrders', summary: 'Listar mis pedidos' })
  @ApiOkResponse({ type: OrderSummaryPageDto, description: 'Página de pedidos.' })
  @ApiProblemResponses(401, 422, 429, 500)
  orders(@Query() query: MyOrdersQueryDto): Page<never> {
    return { items: [], page: query.page, pageSize: MY_ORDERS_PAGE_SIZE, total: 0 }
  }

  /**
   * Devuelve la libreta del cliente, con la predeterminada primero.
   *
   * @param session - Sesión del cliente.
   * @returns Las direcciones (puede estar vacía).
   */
  @Get('addresses')
  @UseGuards(CustomerSessionGuard)
  @ApiCookieAuth('customerSession')
  @ApiOperation({ operationId: 'listMyAddresses', summary: 'Listar mis direcciones' })
  @ApiOkResponse({
    description: 'Direcciones guardadas (puede estar vacía).',
    schema: { type: 'array', items: schemaRef('Address') },
  })
  @ApiProblemResponses(401, 429, 500)
  addresses(@CurrentSession() session: SessionRecord): Promise<AddressView[]> {
    return this.listAddresses.execute(customerIdOf(session))
  }

  /**
   * Agrega una dirección; si viene con `isDefault: true`, la anterior deja de ser la
   * predeterminada.
   *
   * @param body - Dirección completa, ya validada y normalizada.
   * @param session - Sesión del cliente.
   * @returns La dirección guardada, con su id.
   */
  @Post('addresses')
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'createMyAddress', summary: 'Guardar una dirección' })
  @ApiBody({ required: true, schema: schemaRef('AddressBookInput') })
  @ApiCreatedResponse({ schema: schemaRef('Address'), description: 'Dirección guardada.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  create(
    @Body() body: AddressBookInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<AddressView> {
    return this.createAddress.execute(customerIdOf(session), body.toInput())
  }

  /**
   * Reemplaza una dirección de la libreta (el cuerpo lleva la dirección completa).
   *
   * @param id - Id de la dirección.
   * @param body - Dirección completa, ya validada y normalizada.
   * @param session - Sesión del cliente.
   * @returns La dirección modificada.
   * @throws {AddressNotFoundError} 404 si no existe o es de otro cliente.
   */
  @Patch('addresses/:id')
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateMyAddress', summary: 'Modificar una dirección' })
  @ApiParam(ADDRESS_ID_PARAM)
  @ApiBody({ required: true, schema: schemaRef('AddressBookInput') })
  @ApiOkResponse({ schema: schemaRef('Address'), description: 'Dirección modificada.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  replace(
    @Param('id') id: string,
    @Body() body: AddressBookInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<AddressView> {
    return this.updateAddress.execute(customerIdOf(session), id, body.toInput())
  }

  /**
   * Borra una dirección de la libreta.
   *
   * @param id - Id de la dirección.
   * @param session - Sesión del cliente.
   * @throws {AddressNotFoundError} 404 si no existe o es de otro cliente.
   */
  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerSessionGuard, CustomerCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'deleteMyAddress', summary: 'Borrar una dirección' })
  @ApiParam(ADDRESS_ID_PARAM)
  @ApiNoContentResponse({ description: 'Dirección borrada.' })
  @ApiProblemResponses(401, 403, 404, 429, 500)
  async remove(@Param('id') id: string, @CurrentSession() session: SessionRecord): Promise<void> {
    await this.deleteAddress.execute(customerIdOf(session), id)
  }
}
