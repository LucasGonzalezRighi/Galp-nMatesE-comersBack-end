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
          text: 'Caño cincelado, pico de bronce y filtro tipo pala. En 15 y 18 cm.',
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
          titleLines: ['Elegí', 'el color.'],
          text: 'Negro, marrón, crudo o borravino. Elegís el color en la página de cada mate.',
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
      collection: { eyebrow: 'Colección', title: 'Categorías' },
      featured: { eyebrow: 'Destacados', title: 'Los más vendidos' },
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
      partners: [{ name: 'Bruno Galimberti', role: 'Socio fundador', photo: null }],
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
                'Sí, enviamos a todo el país. El costo depende del método (domicilio, sucursal o retiro sin costo) y lo ves antes de pagar.',
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
                'Los datos de la tarjeta los carga y procesa Mercado Pago. Nosotros solo guardamos la marca y los últimos 4 dígitos.',
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
                'Sí, dentro de los 30 días corridos de recibido, sin uso y en su estado original. Escribinos a galpon.mates@gmail.com con tu número de pedido y coordinamos. Los cambios no limitan la garantía legal ni tu derecho de arrepentimiento.',
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
            {
              question: '¿Qué garantía tienen los productos?',
              answer:
                'Los mates y las bombillas nuevos tienen 6 meses de garantía legal por defectos (Ley 24.240). Si aparece una falla, escribinos: el traslado corre por nuestra cuenta. Más en Cambios y devoluciones.',
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
          'Calabaza natural curable, cuero vacuno cosido a mano y base de alpaca o cuero según el modelo. La virola de cada mate está en su descripción.',
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
        'Enviamos a todo el país: el costo depende del método y lo ves antes de pagar. También podés retirar sin costo. Tenés 10 días corridos para arrepentirte, 30 días corridos para cambios y 6 meses de garantía legal en mates y bombillas.',
    },
  },
  {
    key: 'legal-terms',
    data: {
      title: 'Términos y condiciones',
      updatedAt: '2026-11-09',
      body: 'Estos términos explican cómo funcionan las compras en Galpón Mates: quién te vende, cómo se arma el pedido, los precios, el pago, el envío y tus derechos.\n\n## Quién te vende\n\n- Nombre comercial: Galpón Mates.\n- Razón social: {{razon_social}}.\n- CUIT: {{cuit}}.\n- Condición frente al IVA: {{condicion_iva}}.\n- Domicilio: {{domicilio}}.\n- Email: {{email}}.\n- Atención: {{area_atencion}}, {{horario_atencion}}.\n\nAl pie de cada página están los enlaces a Defensa del Consumidor y, cuando está disponible, el acceso a Data Fiscal de ARCA.\n\n## Cuándo se aplican estos términos\n\nMirar la tienda no te obliga a nada. Estos términos se aplican a tu compra cuando confirmás el pedido con el botón "Pagar". Antes de pagar podés leerlos en esta página y guardarlos o imprimirlos con el botón "Imprimir o guardar como PDF".\n\nPara comprar tenés que ser mayor de 18 años.\n\n## Cómo se compra\n\n- Elegís los productos y los sumás al carrito. Podés comprar sin crear una cuenta.\n- En el checkout cargás tus datos de contacto, elegís el método de envío y, después, el medio de pago.\n- Antes de pagar ves el detalle del pedido con los productos, el costo del envío y el total. Si algo está mal, volvé al paso anterior o al carrito y corregilo.\n- Al tocar "Pagar" confirmás el pedido. Te reservamos los productos por 30 minutos para que completes el pago.\n\nComprar por internet tiene algunos riesgos propios del medio, como una conexión que se corta en medio del pago. Si pasa, revisá el estado de tu pedido antes de volver a pagar o escribinos.\n\n## Los productos\n\nMostramos cada producto con fotos y una descripción. Muchas piezas son de calabaza y cuero: los tonos, las vetas y las terminaciones pueden variar un poco de una pieza a otra. Las imágenes de ambientación del inicio están hechas con inteligencia artificial y, como el mate en 3D, son ilustrativas: no muestran un producto puntual.\n\nLa yerba se vende en su paquete cerrado de fábrica, con los datos de su rótulo.\n\n## Precios y ofertas\n\nLos precios están en pesos argentinos y son finales. También mostramos el "Precio sin impuestos nacionales". El costo del envío es fijo según el método que elijas y lo ves antes de pagar. El descuento del kit se aplica sobre el total del kit y también lo ves antes de pagar.\n\nLas ofertas valen mientras están publicadas y hasta agotar el stock disponible.\n\n## Pagos y cuotas\n\nLos pagos se hacen con Mercado Pago. Los medios y las cuotas disponibles, con su costo financiero total, te los muestra Mercado Pago al momento de pagar. Una cuota es "sin interés" solo si no pagás ningún interés por ella.\n\n## Cuándo queda hecha la compra\n\nLa compra queda hecha cuando confirmás el pedido y Mercado Pago aprueba el pago. Te mandamos la confirmación por mail. No hace falta ninguna aprobación nuestra después de tu pago.\n\nSi después de pagar nos falta stock de algún producto, te avisamos y te devolvemos el total que pagaste, por el mismo medio de pago.\n\n## Envíos y retiro\n\nPodés elegir envío a domicilio, envío a sucursal o retiro en persona sin costo. El costo de cada método lo ves en el checkout, antes de pagar. Cuando despachamos el pedido, cargamos el número de seguimiento y lo ves en tu pedido. Si elegís retiro en persona, te escribimos para coordinar el día, el horario y el lugar.\n\nSi el pedido llega dañado o no llega, escribinos y lo resolvemos nosotros: el riesgo del transporte no corre por tu cuenta.\n\n## Derecho de arrepentimiento\n\nTenés 10 días corridos desde que recibís el producto para arrepentirte de la compra, sin dar explicaciones y sin costo. Lo pedís con el [Botón de arrepentimiento](/arrepentimiento), sin necesidad de tener una cuenta, o por mail a {{email}}. Te devolvemos todo lo que pagaste, por el mismo medio de pago. El detalle está en [Cambios, devoluciones y arrepentimiento](/devoluciones).\n\n## Garantía legal\n\nLos mates y las bombillas nuevos tienen 6 meses de garantía legal por defectos desde que los recibís (Ley 24.240). Si aparece una falla, lo reparamos; si la reparación no queda bien, podés elegir el cambio por otro igual, la devolución de lo que pagaste o una rebaja del precio. El traslado corre por nuestra cuenta. Si la yerba llega abierta, vencida o en mal estado, te la cambiamos o te devolvemos lo que pagaste.\n\n## Cambios\n\nAdemás de lo que manda la ley, podés cambiar un producto dentro de los 30 días corridos de recibido, sin uso y en su estado original, al precio que pagaste. Los cambios no limitan ni reemplazan la garantía legal ni tu derecho de arrepentimiento. El detalle está en [Cambios, devoluciones y arrepentimiento](/devoluciones).\n\n## Reseñas\n\nPodés dejar una reseña de cualquier producto. Antes de publicarla la revisamos: no publicamos insultos, datos personales de otras personas ni contenido que no tenga que ver con el producto. Nunca rechazamos, ocultamos ni sancionamos una reseña por ser negativa. Si querés que borremos una reseña tuya, escribinos a {{email}}.\n\n## Propiedad intelectual\n\nLos textos, las fotos, el diseño y la marca Galpón Mates son de sus titulares y no se pueden usar sin permiso. Las marcas de terceros que nombramos, como Canarias, Mercado Pago, Visa, Mastercard y American Express, son de sus respectivos dueños.\n\n## Responsabilidad\n\nRespondemos por los productos que vendemos y por los daños que te cause su compra, en los términos de la Ley 24.240 y del Código Civil y Comercial. Nada de lo que dicen estos términos limita esa responsabilidad ni tus derechos como consumidor.\n\n## Datos personales\n\nCómo usamos tus datos lo explica la [Política de privacidad](/privacidad), y lo que guarda la tienda en tu navegador, la [Política de cookies](/cookies).\n\n## Consultas y reclamos\n\nPara cualquier consulta o reclamo escribinos a {{email}} o usá el [formulario de contacto](/contacto). También podés reclamar ante Defensa del Consumidor de la Ciudad de Buenos Aires, ante la Ventanilla Federal Única de la Nación (los dos enlaces están al pie de esta página) o ante la autoridad de defensa del consumidor de tu domicilio.\n\n## Ley aplicable y jurisdicción\n\nEstos términos se rigen por las leyes de la República Argentina. Si tenés un reclamo, podés hacerlo ante los tribunales de tu domicilio o del lugar donde recibiste el producto.\n\n## Cambios en estos términos\n\nSi cambiamos estos términos, publicamos la versión nueva en esta página con su fecha de actualización, que ves arriba. Los cambios valen solo para las compras que se hagan desde esa fecha: cada compra se rige por los términos vigentes cuando la confirmaste.',
    },
  },
  {
    key: 'legal-privacy',
    data: {
      title: 'Política de privacidad',
      updatedAt: '2026-11-09',
      body: 'Esta política te cuenta qué datos personales usa Galpón Mates, para qué, con quién los compartimos, cuánto tiempo los guardamos y cómo ejercés tus derechos. Es independiente de los [Términos y condiciones](/terminos).\n\n## Quién es el responsable de tus datos\n\nEl responsable es {{razon_social}}, CUIT {{cuit}}, con domicilio en {{domicilio}}. Para cualquier tema de datos personales, escribinos a {{email}}.\n\n## Qué datos pedimos y en qué formulario\n\nSolo te pedimos lo que hace falta para cada cosa. Los datos opcionales los podés dejar en blanco.\n\n- Crear una cuenta: nombre, apellido, email y contraseña. La contraseña no se guarda tal cual: guardamos una versión transformada que no permite leerla.\n- Datos de tu cuenta: nombre, apellido, teléfono (opcional) y las direcciones que guardes.\n- Comprar: email, nombre, apellido, teléfono (opcional) y la dirección de envío o los datos de la sucursal, según el método que elijas. Si elegís retiro en persona, no te pedimos dirección.\n- Pagar con tarjeta: el número, el vencimiento y el código de seguridad los cargás en campos de Mercado Pago y no pasan por nuestra tienda. Mercado Pago también te pide el titular y el tipo y número de documento. De la tarjeta solo guardamos la marca, los últimos 4 dígitos y el banco emisor.\n- Escribirnos por el formulario de contacto: nombre, email, motivo, mensaje y número de pedido (opcional).\n- Pedir el arrepentimiento de una compra: nombre, el email que usaste en la compra, número de pedido (opcional) y comentario (opcional). No hace falta tener una cuenta.\n- Dejar una reseña: la puntuación, el texto y el nombre que quieras mostrar (opcional; puede ser tu nombre de pila o tus iniciales). No te pedimos el email.\n\nAdemás, cuando usás la tienda se generan algunos datos técnicos:\n\n- una cookie de sesión, que te mantiene dentro de tu cuenta y protege los formularios (más en la [Política de cookies](/cookies));\n- un identificador del dispositivo que toma Mercado Pago cuando pagás con tarjeta, para prevenir fraudes;\n- la dirección IP y el navegador desde los que entrás, que quedan en los registros del servidor por seguridad.\n\n## Para qué los usamos\n\n- Tomar, cobrar, preparar y entregar tus pedidos.\n- Manejar tu cuenta.\n- Responder tus consultas y reclamos.\n- Tramitar arrepentimientos, cambios y garantías.\n- Publicar las reseñas que nos mandás.\n- Proteger la tienda y prevenir fraudes.\n- Cumplir nuestras obligaciones legales y fiscales.\n\nNo usamos tus datos para publicidad.\n\n## Por qué podemos usarlos\n\nLos datos que necesitamos para venderte y entregarte lo que compraste se usan porque hacen falta para cumplir esa compra (Ley 25.326, art. 5). Publicar una reseña es voluntario: la publicamos porque nos la mandaste, y podés pedir que la borremos cuando quieras.\n\n## Qué pasa si no nos das tus datos\n\nSin tu email, tu nombre y, si pedís envío, la dirección o los datos de la sucursal, no podemos tomar ni entregar tu pedido. Sin tu nombre y el email de la compra no podemos ubicar una solicitud de arrepentimiento. Los datos opcionales no cambian nada de tu compra.\n\n## Con quién los compartimos\n\nCompartimos tus datos solo con quienes nos ayudan a hacer funcionar la tienda, y solo lo que cada uno necesita:\n\n- Mercado Pago, que procesa los pagos: recibe tu email, tu nombre y, si pagás con tarjeta, los datos de la tarjeta y del documento.\n- La empresa de transporte que lleva tu pedido: tu nombre, tu teléfono si lo diste y la dirección o la sucursal.\n- Los proveedores que alojan la tienda y su base de datos.\n- El proveedor de correo electrónico con el que te mandamos los mails de tu pedido y te respondemos.\n\nAlgunos de estos proveedores pueden guardar o procesar los datos fuera de la Argentina. También podemos tener que entregar datos a una autoridad que los pida según la ley. No vendemos tus datos.\n\n## Cuánto tiempo los guardamos\n\n- Tu cuenta: hasta que la elimines.\n- Pedidos y solicitudes de arrepentimiento: 10 años, porque la ley nos obliga a conservar esos registros.\n- Mensajes del formulario de contacto: 24 meses.\n- Registros técnicos de los pagos: 90 días.\n- Enlaces para cambiar la contraseña: los borramos 7 días después de que vencen.\n- Datos técnicos que usamos para no duplicar un pedido o un pago: 48 horas.\n\nPasados esos plazos, los borramos.\n\n## Tus derechos y cómo ejercerlos\n\nPodés pedirnos en cualquier momento:\n\n- Acceso: saber qué datos tuyos tenemos. Te respondemos dentro de los 10 días corridos y es gratis cada 6 meses.\n- Rectificación y actualización: corregir datos que estén mal o desactualizados.\n- Supresión: que borremos tus datos, salvo los que la ley nos obliga a conservar.\n- Revocar tu consentimiento: por ejemplo, pedir que saquemos una reseña tuya.\n\nPara la rectificación, la actualización y la supresión tenemos 5 días hábiles. Escribinos a {{email}}, mejor desde el email de tu cuenta o el de tu compra: solo te pedimos lo necesario para confirmar que sos vos.\n\nAdemás, podés eliminar tu cuenta desde la tienda: entrá a [tu cuenta](/cuenta), elegí "Eliminar mi cuenta" y confirmá con tu contraseña. Al eliminarla borramos tus direcciones, cerramos todas tus sesiones y quitamos tus datos personales de la cuenta. Tus pedidos dejan de estar unidos a la cuenta y de cada uno conservamos solo los datos mínimos del comprobante, por el plazo de 10 años que pide la ley.\n\n## Agencia de Acceso a la Información Pública\n\nLA AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.\n\nEncontrás cómo contactarla en el [sitio de la Agencia](https://www.argentina.gob.ar/aaip).\n\n## Cómo cuidamos tus datos\n\nUsamos medidas técnicas y de organización razonables para proteger tus datos: la tienda funciona con conexión cifrada, las contraseñas no se guardan tal cual y los datos de la tarjeta no pasan por nuestros servidores. Ningún sistema es infalible, así que no podemos prometer una seguridad absoluta.\n\n## Cookies y almacenamiento en tu navegador\n\nLa tienda usa una cookie de sesión y guarda en tu navegador el carrito y la compra en curso. No usamos cookies de analítica ni de publicidad. El detalle está en la [Política de cookies](/cookies).\n\n## Menores de edad\n\nPara comprar y para crear una cuenta tenés que ser mayor de 18 años.\n\n## Cambios en esta política\n\nSi cambiamos esta política, publicamos la versión nueva en esta página con su fecha de actualización, que ves arriba. Los cambios valen desde esa fecha.',
    },
  },
  {
    key: 'legal-cookies',
    data: {
      title: 'Política de cookies',
      updatedAt: '2026-11-09',
      body: 'Esta política explica qué guarda Galpón Mates en tu navegador, para qué y por cuánto tiempo.\n\n## Qué son las cookies y el almacenamiento local\n\nUna cookie es un archivo chiquito que un sitio guarda en tu navegador para recordar algo entre una página y otra, como que ya ingresaste a tu cuenta. El almacenamiento local es parecido: el sitio guarda datos en tu navegador, por ejemplo tu carrito, y no los manda solo a ningún servidor.\n\n## Qué usamos\n\nTodo lo que usamos es necesario para que la tienda funcione o para que el pago sea seguro:\n\n- Cookie __Host-galpon_session, nuestra: mantiene tu sesión y protege los formularios contra envíos falsos. Dura 24 horas si no ingresaste a una cuenta y 30 días si ingresaste.\n- Cookie __Host-galpon_admin, nuestra: mantiene la sesión del panel de administración de la tienda. Dura 8 horas y solo la reciben quienes administran la tienda.\n- galpon.cart, en el almacenamiento local, nuestro: guarda tu carrito. No vence: queda hasta que lo vacíes o borres los datos del navegador.\n- galpon.checkout y galpon.order, en el almacenamiento de la sesión, nuestros: guardan la compra en curso (tus datos de contacto, el envío y el pedido) hasta que cierres la pestaña. Nunca guardan datos de la tarjeta.\n- MercadoPago.js, de Mercado Pago: se carga solo cuando elegís pagar con tarjeta. Muestra los campos de la tarjeta y toma un identificador del dispositivo para prevenir fraudes. Su duración la define Mercado Pago.\n\nSi pagás en el sitio de Mercado Pago (Checkout Pro) o tu banco te pide una verificación (3-D Secure), esas páginas son de Mercado Pago o de tu banco y lo que guarden se rige por sus propias políticas.\n\nCuando el pie de la tienda muestra el logo de Data Fiscal, tu navegador le pide esa imagen al sitio de ARCA (www.afip.gob.ar). La tienda no suma cookies con ese pedido.\n\n## Qué no usamos\n\nNo usamos cookies de analítica ni de publicidad. Tampoco usamos píxeles de redes sociales ni videos o mapas de otros sitios incrustados en la tienda.\n\n## Cómo borrarlas o bloquearlas\n\nPodés borrar las cookies y el almacenamiento local desde la configuración de tu navegador, en la sección de privacidad o de datos de sitios. Si los borrás o los bloqueás:\n\n- se vacía tu carrito;\n- se cierra tu sesión y no vas a poder ingresar a tu cuenta mientras estén bloqueadas;\n- si estabas en medio de una compra, vas a tener que empezarla de nuevo;\n- si bloqueás a Mercado Pago, no vas a poder pagar con tarjeta.\n\n## Si un día sumamos otras cookies\n\nSi en el futuro queremos usar cookies que no sean necesarias, como las de analítica, te vamos a pedir permiso antes de usarlas, con la opción de rechazarlas y de cambiar tu elección cuando quieras. También vamos a actualizar esta política.\n\n## Contacto y actualización\n\nSi tenés dudas sobre esta política, escribinos a {{email}}. Cómo usamos tus datos personales lo explica la [Política de privacidad](/privacidad). La fecha de la última actualización está arriba.',
    },
  },
  {
    key: 'legal-returns',
    data: {
      title: 'Cambios, devoluciones y arrepentimiento',
      updatedAt: '2026-11-09',
      body: 'Acá te contamos qué podés hacer si te arrepentís de una compra, si un producto tiene una falla o si lo querés cambiar.\n\n## Tres caminos distintos\n\n- Arrepentimiento: por ley, podés deshacer la compra sin dar explicaciones.\n- Garantía legal: por ley, si un producto tiene un defecto.\n- Cambios: los ofrecemos nosotros, además de lo que manda la ley.\n\nSon independientes: usar uno no te quita los otros, y nuestra política de cambios no limita la garantía legal ni tu derecho de arrepentimiento.\n\n## Arrepentimiento\n\n- Plazo: 10 días corridos desde que recibís el producto. Si el último día es inhábil, el plazo pasa al día hábil siguiente.\n- Cómo: con el [Botón de arrepentimiento](/arrepentimiento) o por mail a {{email}}. No hace falta tener una cuenta: alcanza con tu nombre y el email que usaste en la compra, para que podamos confirmar que la compra es tuya.\n- Código del trámite: apenas mandás la solicitud con el botón, te mostramos un código que identifica tu trámite, y también te lo mandamos por mail.\n- Devolución del producto: te escribimos para coordinar cómo nos lo hacés llegar. Es sin costo: el envío de vuelta lo pagamos nosotros.\n- Estado del producto: devolvelo en el estado en que lo recibiste.\n- Excepciones: solo las que fija la ley, por ejemplo un paquete de yerba que ya abriste.\n- Reembolso: te devolvemos todo lo que pagaste, envío incluido, por el mismo medio de pago y sin demoras.\n\n## Garantía legal\n\nLos mates y las bombillas nuevos tienen 6 meses de garantía legal por defectos, desde que los recibís (Ley 24.240).\n\n- Si aparece una falla, escribinos a {{email}} con tu número de pedido y una foto o una descripción del problema.\n- Lo reparamos; si la reparación no queda bien, podés elegir el cambio por otro igual, la devolución de lo que pagaste o una rebaja del precio.\n- El traslado del producto corre por nuestra cuenta.\n\nSi un producto llega dañado, avisanos apenas lo recibas, con fotos del producto y del embalaje, así lo resolvemos rápido. Si nos avisás más tarde, la garantía legal sigue valiendo igual.\n\nSi la yerba llega abierta, vencida o en mal estado, te la cambiamos o te devolvemos lo que pagaste.\n\n## Cambios\n\nPodés cambiar un producto dentro de los 30 días corridos de recibido, sin uso y en su estado original. Te respetamos el precio que pagaste. Escribinos a {{email}} con tu número de pedido y coordinamos.\n\n## Contacto y reclamos\n\nPara cualquiera de estos trámites escribinos a {{email}} o usá el [formulario de contacto](/contacto). Te atiende {{area_atencion}}, {{horario_atencion}}. Si no quedás conforme, podés reclamar ante Defensa del Consumidor con los enlaces que están al pie de esta página. Las condiciones generales de compra están en los [Términos y condiciones](/terminos).',
    },
  },
]
