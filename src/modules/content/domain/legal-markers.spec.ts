import { describe, expect, it } from 'vitest'

import { LEGAL_MARKERS, unknownLegalMarkerMessage, unknownLegalMarkers } from './legal-markers'

describe('marcadores de los documentos legales', () => {
  it('son las 8 claves de @galpon/domain', () => {
    expect(LEGAL_MARKERS).toEqual([
      'razon_social',
      'cuit',
      'condicion_iva',
      'domicilio',
      'email',
      'telefono',
      'area_atencion',
      'horario_atencion',
    ])
  })

  it('devuelve las claves desconocidas recortadas, sin repetir y en orden', () => {
    expect(unknownLegalMarkers('Somos {{razon_social}}, CUIT {{ cuit }}.')).toEqual([])
    expect(unknownLegalMarkers('{{cuitt}} {{ otro }} {{cuitt}} {{email}} {{}}')).toEqual([
      'cuitt',
      'otro',
      '',
    ])
    expect(unknownLegalMarkers('Sin marcadores { ni } llaves sueltas')).toEqual([])
  })

  it('arma el mensaje del front y lanza en español con algo que no es texto', () => {
    expect(unknownLegalMarkerMessage('cuitt')).toBe(
      'El dato {{cuitt}} no existe. Revisá la lista de datos del vendedor.',
    )
    expect(() => unknownLegalMarkers(3 as unknown as string)).toThrow(/texto/)
  })
})
