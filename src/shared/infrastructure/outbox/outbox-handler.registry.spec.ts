import { describe, expect, it } from 'vitest'

import { type OutboxEventHandler, OutboxHandlerRegistry } from './outbox-handler.registry'

/** Handler que no hace nada (alcanza para el registro). */
function handler(): OutboxEventHandler {
  return { handle: () => Promise.resolve() }
}

describe('OutboxHandlerRegistry', () => {
  it('devuelve los dos handlers de un tipo en el orden en que se registraron', () => {
    const registry = new OutboxHandlerRegistry()
    const first = handler()
    const second = handler()

    registry.register('combo.changed', first)
    registry.register('combo.changed', second)
    registry.register('order.expired', handler())

    expect(registry.handlersFor('combo.changed')).toEqual([first, second])
  })

  it('un tipo sin handlers devuelve una lista vacía', () => {
    const registry = new OutboxHandlerRegistry()
    registry.register('order.expired', handler())

    expect(registry.handlersFor('order.created')).toEqual([])
    expect(registry.handlersFor('constructor')).toEqual([])
  })

  it('rechaza un tipo vacío o un handler sin handle', () => {
    const registry = new OutboxHandlerRegistry()

    expect(() => {
      registry.register('  ', handler())
    }).toThrow(TypeError)
    expect(() => {
      registry.register('combo.changed', {} as OutboxEventHandler)
    }).toThrow('handle')
  })
})
