// Generado por scripts/import-fixtures.mjs desde las fixtures del front: no editar a mano.
import type { SeedCombo } from './types'

/** Combos del diseño, por `position`, con sus piezas en el orden del combo. */
export const SEED_COMBOS: readonly SeedCombo[] = [
  {
    key: 'cmb-duo-imperial',
    name: 'Dúo Imperial',
    description: 'El imperial de ceremonia con el bombillón curvo de pico de bronce.',
    productSlugs: ['mate-imperial-premium', 'bombillon-premium-curvo'],
    priceArs: 61999,
    status: 'published',
    position: 1,
  },
  {
    key: 'cmb-camionero-y-canarias',
    name: 'Camionero y Canarias',
    description: 'Boca amplia, virola de aluminio y un kilo de Canarias para arrancar.',
    productSlugs: ['camionero-virola-de-aluminio', 'yerba-canarias-1-kg'],
    priceArs: 31499,
    status: 'published',
    position: 2,
  },
  {
    key: 'cmb-torpedo-completo',
    name: 'Torpedo completo',
    description:
      'Las tres piezas ya elegidas: torpedo cincelado, bombillón de alpaca y Canarias Serena.',
    productSlugs: [
      'mate-torpedo-virola-de-alpaca-cincelada',
      'bombillon-100-alpaca',
      'yerba-canarias-serena-1-kg',
    ],
    priceArs: 67999,
    status: 'published',
    position: 3,
  },
  {
    key: 'cmb-bombilla-y-yerba',
    name: 'Bombilla y yerba',
    description: 'Para el que ya tiene su mate: bombillón de alpaca y Canarias Té y Jengibre.',
    productSlugs: ['bombillon-100-alpaca', 'yerba-canarias-te-y-jengibre-1-kg'],
    priceArs: 34999,
    status: 'published',
    position: 4,
  },
  {
    key: 'cmb-galleta-y-canarias',
    name: 'Galleta y Canarias',
    description: 'El galleta de siempre con un kilo de Canarias.',
    productSlugs: ['mate-galleta', 'yerba-canarias-1-kg'],
    priceArs: 33999,
    status: 'draft',
    position: 5,
  },
]
