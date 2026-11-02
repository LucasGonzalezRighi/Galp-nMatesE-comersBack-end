// Formas de lectura de los contenidos: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`). Los límites de largo los valida quien escribe (seed y,
// desde B5, el admin).

/** Foto (`Image`). */
export interface ContentImage {
  /** Identificador estable de la foto. */
  publicId: string
  /** URL que sirve la tienda. */
  url: string
  /** Ancho en píxeles. */
  width: number
  /** Alto en píxeles. */
  height: number
  /** Texto alternativo. */
  alt: string
}

/** Antetítulo y título de una sección (`SectionHeading`). */
export interface SectionHeading {
  /** Antetítulo. */
  eyebrow: string
  /** Título. */
  title: string
}

/** Escena del recorrido del inicio (`StoryScene`). */
export interface StoryScene {
  /** Escena. */
  key: 'pieces' | 'gourd' | 'bombilla' | 'yerba' | 'ritual' | 'leather'
  /** Antetítulo. */
  eyebrow: string
  /** Líneas del título (1 a 3). */
  titleLines: string[]
  /** Texto. */
  text: string
  /** Texto del botón, o `null` sin botón. */
  ctaLabel: string | null
}

/** Contenido del inicio (`HomeContent`). */
export interface HomeContent {
  /** Portada. */
  hero: {
    eyebrow: string
    titleLines: string[]
    text: string
    primaryCtaLabel: string
    secondaryCtaLabel: string
  }
  /** Las seis escenas del recorrido. */
  scenes: StoryScene[]
  /** Los cuatro pasos del ritual. */
  ritualSteps: string[]
  /** Slugs de los productos del recorrido. */
  storyProducts: { hero: string; bombillas: string[]; yerbas: string[] }
  /** Encabezado de la colección. */
  collection: SectionHeading
  /** Encabezado de los destacados. */
  featured: SectionHeading
  /** Encabezado de las reseñas. */
  reviews: SectionHeading
  /** Manifiesto. */
  manifesto: { eyebrow: string; text: string; ctaLabel: string }
  /** Números del galpón. */
  stats: { provinces: number; partners: number }
  /** Bloque del kit. */
  kitBlock: { eyebrow: string; title: string; text: string; ctaLabel: string }
}

/** Contenido de "Nosotros" (`AboutContent`). */
export interface AboutContent {
  /** Portada. */
  hero: { eyebrow: string; titleLines: string[]; text: string }
  /** Socios, con su foto o `null`. */
  partners: { name: string; role: string; photo: ContentImage | null }[]
  /** Cita. */
  quote: string
  /** Antetítulo de los pasos. */
  stepsEyebrow: string
  /** Los tres pasos. */
  steps: { title: string; text: string }[]
  /** Texto del botón. */
  ctaLabel: string
}

/** Preguntas frecuentes por categoría (`FaqContent`). */
export interface FaqContent {
  /** Categorías con sus preguntas. */
  categories: {
    id: string
    label: string
    items: { question: string; answer: string }[]
  }[]
}

/** Pie de página (`FooterContent`). */
export interface FooterContent {
  /** Frase corta. */
  tagline: string
  /** Texto. */
  text: string
  /** Medios de pago que se muestran. */
  paymentMethods: string[]
  /** Enlace a Defensa del Consumidor, o `null`. */
  consumerDefenseUrl: string | null
}

/** Pestañas de la ficha de un grupo de productos (`ProductTabsGroupContent`). */
export interface ProductTabsGroupContent {
  /** Nota bajo la descripción, o `null`. */
  descriptionNote: string | null
  /** Título de la pestaña Materiales. */
  materialsTitle: string
  /** Texto de Materiales. */
  materials: string
  /** Título de la pestaña Cuidado. */
  careTitle: string
  /** Texto de Cuidado. */
  care: string
}

/** Pestañas de la ficha por grupo, más el texto de envíos (`ProductTabsContent`). */
export interface ProductTabsContent {
  /** Pestañas de los mates. */
  mate: ProductTabsGroupContent
  /** Pestañas de las bombillas. */
  bombilla: ProductTabsGroupContent
  /** Pestañas de las yerbas. */
  yerba: ProductTabsGroupContent
  /** Texto de la pestaña Envíos, común a todos. */
  shipping: string
}

/** Documento legal (`LegalContent`). */
export interface LegalContent {
  /** Título. */
  title: string
  /** Fecha de la última actualización (`YYYY-MM-DD`). */
  updatedAt: string
  /** Texto completo. */
  body: string
}

/** Forma del contenido de cada clave; `GetContentQuery` exige que cubra todas las `ContentKey`. */
export interface ContentByKey {
  home: HomeContent
  about: AboutContent
  faq: FaqContent
  footer: FooterContent
  'product-tabs': ProductTabsContent
  'legal-terms': LegalContent
  'legal-privacy': LegalContent
}
