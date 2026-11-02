// Generado por scripts/import-fixtures.mjs desde las fixtures del front: no editar a mano.
import type { SeedContentBlock } from './types'

/** Contenidos editables, uno por clave. */
export const SEED_CONTENT_BLOCKS: readonly SeedContentBlock[] = [
  {
    key: 'home',
    data: {
      hero: {
        eyebrow: 'Hechos para compartir',
        titleLines: ['Encontrá', 'tu mate.'],
        text: 'Calabaza curada, virola de alpaca cincelada y bombillones de bronce. Bajá: te mostramos cada pieza de cerca.',
        primaryCtaLabel: 'Ver la tienda',
        secondaryCtaLabel: 'Armá tu kit',
      },
      scenes: [
        {
          key: 'pieces',
          eyebrow: 'La ronda completa',
          titleLines: ['Tres piezas.', 'Una ronda.'],
          text: 'Mate, bombilla y yerba. Cada una se elige por separado, o las tres juntas con −10% armando el kit.',
          ctaLabel: null,
        },
        {
          key: 'gourd',
          eyebrow: 'Mate',
          titleLines: ['Calabaza curada.', 'Virola de alpaca.'],
          text: 'Cada calabaza se elige por su forma y sus paredes. La virola se cincela a mano y la base de bronce lo mantiene firme sobre la mesa.',
          ctaLabel: 'Ver mates',
        },
        {
          key: 'bombilla',
          eyebrow: 'El bombillón',
          titleLines: ['Alpaca', 'y bronce.'],
          text: 'Caño cincelado, pico de bronce y filtro tipo pala que no se tapa. En 15 y 18 cm.',
          ctaLabel: 'Ver bombillones',
        },
        {
          key: 'yerba',
          eyebrow: 'La yerba',
          titleLines: ['Para cada', 'cebada.'],
          text: 'Llenala hasta tres cuartos, tapá, agitá y armá la montañita. Canarias en tres versiones, paquete de 1 kg.',
          ctaLabel: null,
        },
        {
          key: 'ritual',
          eyebrow: 'El ritual',
          titleLines: ['Agua a 75 °C.', 'Nunca hervida.'],
          text: 'Siempre sobre el costado de la bombilla, para no lavar la montañita. El primero es del cebador; después, arranca la ronda.',
          ctaLabel: null,
        },
        {
          key: 'leather',
          eyebrow: 'Hacelo tuyo',
          titleLines: ['Elegí', 'el cuero.'],
          text: 'Negro, marrón, crudo o borravino. Elegís el cuero y la virola en la página de cada mate.',
          ctaLabel: 'Armá tu kit',
        },
      ],
      ritualSteps: ['Yerba', 'Montañita', 'Bombilla', 'Agua'],
      storyProducts: {
        hero: 'mate-imperial-premium',
        bombillas: ['bombillon-premium-curvo', 'bombillon-100-alpaca'],
        yerbas: [
          'yerba-canarias-1-kg',
          'yerba-canarias-serena-1-kg',
          'yerba-canarias-te-y-jengibre-1-kg',
        ],
      },
      collection: { eyebrow: 'Colección', title: 'Seis líneas para cada ronda' },
      featured: { eyebrow: 'Destacados', title: 'Los más elegidos de la ronda' },
      reviews: { eyebrow: 'Reseñas', title: 'Lo que dice la ronda' },
      manifesto: {
        eyebrow: 'Manifiesto',
        text: 'Un mate no se compra: se elige. Calabaza curada, alpaca cincelada a mano y cuero cosido punto por punto. Piezas hechas para durar muchas rondas.',
        ctaLabel: 'Conocé la historia del galpón',
      },
      stats: { partners: 2, provinces: 24 },
      kitBlock: {
        eyebrow: 'Armá tu kit',
        title: 'Mate, bombilla y yerba.',
        text: 'Elegí las tres piezas en tres pasos. El descuento se aplica solo sobre el total del kit.',
        ctaLabel: 'Armar mi kit',
      },
    },
  },
  {
    key: 'about',
    data: {
      hero: {
        eyebrow: 'Sobre nosotros',
        titleLines: ['Dos socios.', 'Un galpón.', 'La ronda de siempre.'],
        text: 'Galpón nació entre dos socios que compartían la misma costumbre: un buen mate al lado. Hoy elegimos cada pieza, la revisamos a mano y la mandamos a todo el país.',
      },
      partners: [
        { name: 'Bruno Galimberti', role: 'Socio fundador', photo: null },
        { name: 'Nombre del socio', role: 'Socio', photo: null },
      ],
      quote:
        'No vendemos lo que no usaríamos. Cada mate pasa por nuestras manos antes de llegar a las tuyas.',
      stepsEyebrow: 'Cómo trabajamos',
      steps: [
        {
          title: 'Elegimos cada calabaza',
          text: 'Buscamos formas parejas, paredes firmes y buena boca. Si no pasa la revisión, no sale.',
        },
        {
          title: 'Alpaca y bronce',
          text: 'Virolas cinceladas, bases y bombillones con picos de bronce: los detalles que hacen que un mate dure.',
        },
        {
          title: 'Embalado para viajar',
          text: 'Cada pedido sale protegido y con seguimiento, a cualquier provincia del país.',
        },
      ],
      ctaLabel: 'Conocé la tienda',
    },
  },
  {
    key: 'faq',
    data: {
      categories: [
        {
          id: 'envios',
          label: 'Envíos',
          items: [
            {
              question: '¿Hacen envíos a todo el país?',
              answer:
                'Sí, enviamos a las 24 provincias. El costo y el plazo se calculan en el checkout con tu código postal, y podés elegir envío a domicilio o a sucursal.',
            },
            {
              question: '¿Cuánto tarda en llegar mi pedido?',
              answer:
                'Preparamos cada pedido apenas se acredita el pago. Cuando lo despachamos te enviamos por mail el número de seguimiento.',
            },
            {
              question: '¿Cómo sigo mi pedido?',
              answer:
                'Con el número de seguimiento que te llega por mail. Si algo no anda, escribinos a galpon.mates@gmail.com con tu número de pedido.',
            },
          ],
        },
        {
          id: 'pagos',
          label: 'Pagos y cuotas',
          items: [
            {
              question: '¿Qué medios de pago aceptan?',
              answer:
                'Pagás en la web con Mercado Pago: tarjetas de crédito y débito, dinero en cuenta y los demás medios disponibles en la plataforma.',
            },
            {
              question: '¿Puedo pagar en cuotas?',
              answer:
                'Sí, hasta 3 cuotas sin interés con tarjeta de crédito. Las opciones vigentes se muestran al momento de pagar.',
            },
            {
              question: '¿Es seguro pagar en la web?',
              answer:
                'El pago lo procesa Mercado Pago. Nosotros nunca vemos ni guardamos los datos de tu tarjeta.',
            },
          ],
        },
        {
          id: 'curado',
          label: 'Curado del mate',
          items: [
            {
              question: '¿Cómo curo un mate de calabaza?',
              answer:
                'Llenalo con yerba usada humedecida con agua tibia y dejalo reposar 24 horas. Al día siguiente vacialo, raspá suave el interior con una cuchara y repetí el proceso 2 o 3 días.',
            },
            {
              question: '¿Los mates de acero se curan?',
              answer:
                'No hace falta: alcanza con lavarlos con agua caliente antes del primer uso. En los forrados en cuero con interior de calabaza, curá la calabaza igual que en cualquier mate.',
            },
            {
              question: '¿Qué hago si aparece una mancha blanca?',
              answer:
                'Suele pasar si el mate queda húmedo. Lavalo con agua caliente, dejalo secar boca abajo al aire y, si sigue, repetí el curado.',
            },
          ],
        },
        {
          id: 'cuidado',
          label: 'Cuero y alpaca',
          items: [
            {
              question: '¿Cómo cuido el cuero?',
              answer:
                'Después de cada uso, secá el exterior con un paño. Evitá mojarlo de más y dejarlo al sol o cerca del calor. Cada tanto podés humectarlo con crema para cuero incolora.',
            },
            {
              question: '¿Cómo limpio la alpaca y el bronce?',
              answer:
                'Con un paño suave y seco. Si se oscurece, frotá con una pasta de bicarbonato y agua, enjuagá y secá bien. Evitá productos abrasivos.',
            },
            {
              question: '¿Cómo limpio el bombillón?',
              answer:
                'Pasale agua caliente después de cada uso. Una vez por semana dejalo en remojo con agua caliente y bicarbonato, y usá un cepillo fino para el filtro.',
            },
          ],
        },
        {
          id: 'cambios',
          label: 'Cambios y devoluciones',
          items: [
            {
              question: '¿Puedo cambiar un producto?',
              answer:
                'Sí, dentro de los 10 días de recibido, sin uso y en su estado original. Escribinos a galpon.mates@gmail.com con tu número de pedido y coordinamos.',
            },
            {
              question: '¿Qué pasa si llegó dañado?',
              answer:
                'Escribinos apenas lo recibas, con fotos del producto y del embalaje. Lo resolvemos con un cambio o la devolución del dinero.',
            },
            {
              question: '¿Cómo me arrepiento de una compra?',
              answer:
                'Tenés 10 días corridos desde que recibís el producto para arrepentirte, sin dar explicaciones. Usá el Botón de arrepentimiento al pie de la página.',
            },
          ],
        },
        {
          id: 'retiro',
          label: 'Retiro en persona',
          items: [
            {
              question: '¿Puedo retirar mi compra?',
              answer:
                'Sí. Elegí “Retiro en persona” en el checkout: no tiene costo y te escribimos por mail para coordinar día, horario y lugar.',
            },
            {
              question: '¿Qué necesito para retirar?',
              answer:
                'Tu número de pedido y el DNI del titular. Si retira otra persona, avisanos antes por mail.',
            },
          ],
        },
      ],
    },
  },
  {
    key: 'footer',
    data: {
      tagline: 'Hechos para compartir.',
      text: 'Mates, bombillones y yerba con envío a todo el país.',
      paymentMethods: ['Mercado Pago', 'Visa', 'Mastercard', 'American Express'],
      consumerDefenseUrl: null,
    },
  },
  {
    key: 'product-tabs',
    data: {
      mate: {
        descriptionNote:
          'Cada pieza es artesanal: los tonos de la calabaza, el cuero y el cincelado pueden variar.',
        materialsTitle: 'Materiales',
        materials:
          'Calabaza natural curable, virola de alpaca o acero según variante, cuero vacuno cosido a mano y base de alpaca o cuero según el modelo.',
        careTitle: 'Cuidado',
        care: 'Curalo antes del primer uso. Después de cada ronda, secalo boca abajo y evitá el sol directo sobre el cuero. Más detalles en Preguntas frecuentes.',
      },
      bombilla: {
        descriptionNote: null,
        materialsTitle: 'Materiales',
        materials: 'Alpaca con detalles de bronce según el modelo. Filtro tipo pala.',
        careTitle: 'Cuidado',
        care: 'Agua caliente después de cada uso y, una vez por semana, remojo con agua caliente y bicarbonato.',
      },
      yerba: {
        descriptionNote: null,
        materialsTitle: 'Contenido',
        materials: 'Paquete de 1 kg, envasado de fábrica.',
        careTitle: 'Conservación',
        care: 'Guardala en un lugar fresco y seco; una vez abierta, mejor en un frasco hermético.',
      },
      shipping:
        'Enviamos a todo el país: calculás el costo en el checkout con tu código postal. También podés retirar sin costo. Tenés 10 días desde que lo recibís para cambios o arrepentimiento.',
    },
  },
  {
    key: 'legal-terms',
    data: {
      title: 'Términos y condiciones',
      body: 'Texto de ejemplo. Reemplazar por el texto revisado por un profesional antes de publicar.',
      updatedAt: '2026-10-01',
    },
  },
  {
    key: 'legal-privacy',
    data: {
      title: 'Política de privacidad',
      body: 'Texto de ejemplo. Reemplazar por el texto revisado por un profesional antes de publicar.',
      updatedAt: '2026-10-01',
    },
  },
]
