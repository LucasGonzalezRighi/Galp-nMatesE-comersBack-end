# Lanzamiento legal de Galpón Mates

Esta es la lista de lo que **el código no puede hacer solo** antes de abrir la tienda al público.
El back y la tienda ya hacen su parte (textos legales editables, avisos en los formularios, mails
de confirmación, plazos de conservación de datos, eliminar la cuenta, enlaces de Defensa del
Consumidor y Data Fiscal). Lo que sigue lo tiene que hacer una persona: **Lucas**, **el dueño**,
**el abogado** o **el contador**.

Cómo usarla:

- Cada tarea tiene una casilla. Marcala (`[x]`) cuando esté hecha.
- Cada una dice **qué** hay que hacer y **por qué** (la norma que lo pide).
- No es asesoramiento legal: es la lista que salió de la investigación de normas
  (`.superpowers/sdd/2026-11-04-legal-seguridad/research-leyes.md`) y de la auditoría de datos,
  afirmaciones e imágenes (`audit-datos-terceros-afirmaciones-imagenes.md`, en la misma carpeta).
  El abogado tiene la última palabra sobre los textos.

Abreviaturas: **LDC** = Ley de Defensa del Consumidor 24.240; **CCyC** = Código Civil y Comercial;
**AAIP** = Agencia de Acceso a la Información Pública (controla los datos personales).

---

## 1. Antes de abrir: lo imprescindible

Sin esto la tienda no debería salir a producción.

- [ ] **Lucas · Cargar los datos del vendedor en el dashboard** (Ajustes): razón social, CUIT,
      domicilio legal, condición frente al IVA, email, teléfono (opcional), área responsable, horario
      de atención y el código de Data Fiscal (se pega el código que da ARCA; el back guarda solo el
      enlace).
      _Por qué:_ la LDC art. 4 y la Res. SCI 270/2020 piden mostrar quién vende antes de comprar; la
      Disp. 954/2025 art. 6 pide el canal, el área y el horario de atención; la RG 1415 art. 25 pide el
      logo de Data Fiscal. Los cuatro textos legales y el pie de la tienda toman estos datos de ahí:
      si faltan, la tienda en producción los deja vacíos.
- [ ] **Lucas · Cuenta de mails (SMTP) y sus variables.** Contratar un servicio de envío de mails
      (cualquiera que dé SMTP) y definir en el servidor del back `MAIL_MODE=smtp`, `SMTP_HOST`,
      `SMTP_PORT` (465 o 587), `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` (por ejemplo
      `Galpón Mates <hola@tudominio.com.ar>`). Sin ellas el back no arranca en producción.
      _Por qué:_ el CCyC art. 1108 obliga a confirmar el pedido por vía electrónica y sin demora; la
      tienda además promete el mail del pedido, del pago, del despacho y el código del arrepentimiento
      (Disp. 954/2025 art. 5). Conviene configurar SPF y DKIM del dominio para que no caigan en spam.
- [ ] **Lucas · `TRUST_PROXY` con un proxy delante de la tienda.** En producción, poner delante de
      la tienda un proxy (o el del hosting) que escriba la IP real del cliente en `X-Forwarded-For`, y
      definir `TRUST_PROXY` en el back con la IP o red de ese proxy (ver "Proxies de confianza" en el
      README).
      _Por qué:_ sin eso, los límites por cliente de las lecturas públicas, de los pagos y de las
      cuotas no cuentan (todo llega desde la IP del servidor de la tienda). Es parte de cuidar los
      datos y el servicio (Ley 25.326 art. 9, seguridad).
- [ ] **Lucas · Cloudinary.** Crear la cuenta y definir `MEDIA_MODE=cloudinary`,
      `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` en el back (en
      producción son obligatorias). Revisar que la tienda muestre las fotos subidas desde el panel.
      _Por qué:_ las fotos que se suban desde el dashboard se guardan ahí; Cloudinary es además un
      proveedor en el exterior (ver la tarea de contratos, más abajo).
- [ ] **Lucas · Correr las migraciones** (`npx prisma migrate deploy` en producción, `npm run
db:migrate` en desarrollo) y el seed con `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios.
      _Por qué:_ B7 sumó dos migraciones (columnas sin uso fuera y enlaces de consumidor); el seed se
      niega a crear el admin de demostración en producción.
- [ ] **El abogado · Revisar los cuatro textos legales**: Términos y condiciones (`/terminos`),
      Política de privacidad (`/privacidad`), Política de cookies (`/cookies`) y Cambios, devoluciones
      y reembolsos (`/devoluciones`). Se editan desde el dashboard (Contenido).
      _Por qué:_ son textos de fábrica redactados siguiendo las normas, no por un abogado. La Ley
      25.326 art. 6 y la Res. AAIP 14/2018 piden la información de privacidad con la leyenda de la
      AAIP; la Res. 270/2020 y el CCyC 1111 piden términos claros y guardables; la LDC art. 37, el CCyC
      1117-1122 y la Disp. 377/2026 prohíben cláusulas abusivas. Puntos concretos para mirar:
  - qué significa el sello "Compra verificada" de las reseñas (ver la sección 4);
  - edad mínima de 18 años para comprar y crear cuenta;
  - "en el estado en que lo recibiste" en el arrepentimiento, y la excepción del paquete de yerba
    abierto (si se redacta mal, puede ser una cláusula abusiva, Disp. 377/2026 inc. n);
  - la yerba fuera de la garantía legal de 6 meses (cambio o devolución si llega abierta, vencida o
    en mal estado);
  - cómo se redacta el riesgo del transporte, las opciones del art. 17 de la LDC y el certificado de
    garantía del art. 14 en una venta online;
  - si aplica la Ley CABA 3281 (los cambios a 30 días ya la cubrirían);
  - el enlace de la AAIP sin domicilio ni teléfono.
- [ ] **Lucas · Inscribir la base de datos en el Registro Nacional de Bases de Datos** (trámite por
      TAD, a nombre del titular del negocio) y cargar el número de inscripción en la Política de
      privacidad.
      _Por qué:_ la Ley 25.326 art. 21 y el Decreto 1558/2001 art. 1 obligan a inscribir toda base con
      datos personales (la tienda guarda clientes, pedidos y mensajes).

## 2. Lo que tiene que hacer o confirmar cada uno

### Lucas

- [ ] **Contratos con proveedores en el exterior.** Relevar quién guarda o procesa datos de los
      clientes y desde qué país: hosting de la tienda y del back, base de datos, Redis, el servicio de
      mails (SMTP), Cloudinary, Mercado Pago y el correo de atención (hoy un Gmail). Guardar el
      contrato o las cláusulas de cada uno y nombrarlos en la Política de privacidad.
      _Por qué:_ la Ley 25.326 arts. 12 y 25, la Disp. 60/2016 y la Res. AAIP 198/2023 piden garantías
      cuando los datos van a otro país o los trata un tercero por cuenta del negocio.
- [ ] **Cesión escrita de lo que hizo Lucas** al dueño: el código, las imágenes de IA del inicio
      (cuenta de Higgsfield de Lucas) y la foto `yerba-albedo`.
      _Por qué:_ la Ley 11.723 protege las obras; sin una cesión escrita, los derechos siguen siendo
      de quien las hizo.
- [ ] **Plazo de los registros del servidor.** Definir cuánto se guardan los logs con IP y navegador
      en el hosting y escribirlo en la Política de privacidad.
      _Por qué:_ la Ley 25.326 art. 4 inc. 7 pide conservar los datos solo el tiempo necesario. La
      política ya dice que se guardan por seguridad; falta el plazo del hosting.

### El dueño

- [ ] **Cesión escrita de las fotos.** Una declaración firmada de que las fotos de producto son
      suyas o de un fotógrafo que se las cedió, y lo mismo para el logo y los diseños (si los hizo un
      tercero, la cesión del diseñador).
      _Por qué:_ la Ley 11.723 (arts. 1 y 34) protege las fotografías; si alguien reclama, hay que
      poder mostrar el permiso.
- [ ] **Origen de tres imágenes:** `camionero-criollo.jpg` (parece una foto publicitaria distinta de
      las demás), `mate-imperial-premium.jpg` (vino con el diseño; también es la foto de la línea
      Imperiales) y `mate-interior.png` (vino con el diseño, origen desconocido). Si no se sabe de
      dónde salieron, reemplazarlas por fotos propias.
      _Por qué:_ Ley 11.723; publicar una foto ajena sin permiso es una infracción.
- [ ] **Marca en el INPI.** Registrar "Galpón Mates" (clases 21 mates, 30 yerba y 35 comercio).
      _Por qué:_ la Ley 22.362 da la marca a quien la registra; sin registro, otro puede inscribirla y
      reclamar el uso.
- [ ] **Consentimiento del socio.** Si se publica el nombre o la foto del segundo socio en
      `/nosotros`, tener su consentimiento por escrito. Hoy el texto de fábrica no lo nombra, pero
      sigue "Dos socios".
      _Por qué:_ la Ley 25.326 art. 5 (datos personales) y la Ley 11.723 art. 31 (retrato) piden su
      permiso.
- [ ] **Promoción de cuotas real en Mercado Pago.** Confirmar que la cuenta tiene configuradas las
      "3 cuotas sin interés" que muestra la tienda (con el costo a cargo del vendedor) y qué medios de
      pago están habilitados ("Visa, Mastercard, American Express" en el checkout y el pie). Si no es
      así, cambiar `installmentsMax` y los textos en Ajustes.
      _Por qué:_ la Res. SIyC 4/2025 art. 2 y la Res. 446/2025 piden informar las cuotas con el CFT
      real; lo publicado integra la oferta (LDC art. 8).
- [ ] **Quién paga el envío de un cambio** (los textos de devoluciones y términos no lo dicen) y el
      **plazo de respuesta a los reclamos**. Pasárselos al abogado para que los sume.
      _Por qué:_ LDC art. 4 (información clara) y art. 8 (lo publicado obliga).
- [ ] **Criterios de moderación de reseñas** que dicen los términos ("no publicamos insultos, datos
      personales de otras personas ni contenido que no tenga que ver con el producto"): confirmar que
      son los suyos.
      _Por qué:_ lo publicado obliga (LDC art. 8); rechazar reseñas por ser negativas está prohibido.
- [ ] **Yerba importada.** Confirmar que los paquetes que se venden tienen el rótulo argentino
      (importador y registros RNE/RNPA), y si la ficha tiene que mostrar el RNPA.
      _Por qué:_ el Código Alimentario Argentino pide esos datos para vender un alimento importado.
- [ ] **Retiro en persona.** Decir dónde se retira (se carga con los datos del vendedor) y
      comprometerse a escribir para coordinar el retiro, como promete la tienda.
      _Por qué:_ lo publicado obliga (LDC art. 8).

#### Afirmaciones que tiene que confirmar el dueño

Quedan publicadas tal como están. Si alguna no es cierta, hay que cambiarla en el dashboard
(contenido, productos o ajustes). _Por qué:_ el DNU 274/2019 arts. 11 y 64 obliga a poder probar lo
que se afirma, y la LDC art. 8 hace que lo publicado integre el contrato.

- [ ] **Envío a todo el país** (descripción del sitio, pie y varios textos): que el transportista
      llegue a todas las provincias. Si no: "Envíos a domicilio y a sucursal".
- [ ] **Plazo "3 a 6 días hábiles"** de los envíos (Ajustes): que sea el plazo real del transportista.
- [ ] **"Preparamos cada pedido apenas se acredita el pago"**: que haya un plazo cierto. Si no:
      "Preparamos tu pedido cuando se acredita el pago".
- [ ] **"Cada pedido sale protegido y con seguimiento, a cualquier provincia"**: el retiro en
      persona no tiene seguimiento. Si no aplica: "Los envíos salen embalados y con número de
      seguimiento".
- [ ] **"Artesanal", "cincelado a mano", "cosido a mano", "punto por punto"**: que lo confirme el
      proveedor. Si no: "virola de alpaca cincelada", "cuero cosido".
- [ ] **Materiales** de cada modelo: alpaca, bronce (o latón), aluminio, cuero vacuno, calabaza
      natural curable, acero inoxidable.
- [ ] **"100 % alpaca"** de los bombillones: choca con el rótulo "Alpaca cincelada y picos de
      bronce" de la línea y con la foto (pico plateado).
- [ ] **"Imperial Térmico"**: que tenga doble pared o aislación real; si no, cambiar el nombre.
- [ ] **Medidas** "15 cm" y "18 cm" de los bombillones.
- [ ] **"Dos socios", "revisamos cada pieza a mano", "si no pasa la revisión, no sale"**: que sea así
      en la práctica.
- [ ] **Los cuatro cueros (Negro, Marrón, Crudo, Borravino) en los 16 mates**: varias descripciones
      fijan un cuero o no llevan cuero (Torpedo Crudo, cuero liso borravino, Ranchero con manchas
      blancas, Torpedo Línea Acero). Dejar la opción solo en los modelos que se hacen de verdad en los
      cuatro.
- [ ] **Horario de atención**: cargarlo en Ajustes (la Disp. 954/2025 art. 6 lo pide; hoy sale del
      dato del vendedor).

#### Fotos que tiene que confirmar el dueño

Siete fichas cuya descripción no coincide con lo que muestra la foto (no se cambiaron descripciones
ni fotos: no se puede saber cuál es el producto real sin el dueño). _Por qué:_ la LDC arts. 4 y 8 y
el DNU 274/2019 art. 11 piden que la información y la imagen no induzcan a error.

- [ ] **Imperial Premium**, foto 2: muestra otro mate (cuero negro, virola de ondas).
- [ ] **Imperial Criollo**: la descripción dice "marrón" y la foto muestra funda clara, sin pie.
- [ ] **Torpedo Virola de Alpaca Cincelada**: la descripción dice "borravino" y base de alpaca; la
      foto muestra un mate negro con patas. Arrastra al combo "Torpedo completo".
- [ ] **Torpedo Crudo con Base y Anillos**: la foto no muestra virola ni anillos.
- [ ] **Torpedo Alpaca Cincelada c/Cuero**: el "repujado" no se ve.
- [ ] **Ranchero Manchas Blancas**: la descripción dice cuero; la foto muestra una pieza blanca con
      manchas naturales (parece calabaza pintada).
- [ ] **Bombillón Alpaca Pico Loro 18 cm**: la foto muestra un mate y tres bombillones.

### El abogado

Además de la revisión de los cuatro textos (sección 1):

- [ ] **Uso de la marca Canarias** en la animación de la portada (la textura del paquete en el mate
      3D), fuera de la ficha del producto. Conservar las facturas de compra de la yerba original.
      _Por qué:_ Ley 22.362 (marcas): fuera de la ficha puede sugerir una asociación con la marca.
- [ ] **Imágenes hechas con IA** del inicio: los términos ya las declaran ilustrativas; confirmar que
      alcanza.
      _Por qué:_ LDC art. 4 y DNU 274/2019 art. 11 (que la imagen no induzca a error).
- [ ] **Res. GMC 31/26 del MERCOSUR**: cuando Argentina la incorpore (antes del 09/03/2027) habrá
      seis meses para adecuar los textos.

### El contador

- [ ] **Cálculo del "Precio sin impuestos nacionales"** que muestra la tienda debajo de cada precio
      (y si cambia siendo monotributista).
      _Por qué:_ la Res. SIyC 4/2025 art. 2 y la Ley 27.743 piden mostrarlo; el cálculo depende de la
      condición frente al IVA.
- [ ] **Tipo de comprobante** que se emite por cada venta (los términos lo mencionan) y el **plazo
      fiscal de conservación** (la Política de privacidad dice 10 años para pedidos y arrepentimientos,
      y el back los conserva así).
      _Por qué:_ las normas de ARCA sobre comprobantes y conservación de registros.

## 3. Riesgos aceptados por Lucas

Estas son decisiones finales de Lucas (Ruling LS-1). Quedan como están; se anotan para que se sepa
qué norma las mira.

- **El Botón de Arrepentimiento está solo en el pie de la página** (no en el encabezado). Está en
  todas las páginas, en color de acento, en el paso de pago con enlace y en la ficha y la FAQ. La
  **Disp. 954/2025 art. 1** pide el enlace "a simple vista, en lugar destacado y en el primer
  acceso". La sanción posible es la de la LDC art. 47.
- **"Los más vendidos"** queda como título de la selección del inicio, que hoy es manual. El **DNU
  274/2019** (arts. 11 y 64) pide poder probar las afirmaciones de hecho; la LDC art. 8 y el CCyC
  1101 tratan la publicidad engañosa.
- **Las 18 reseñas de ejemplo** quedan como están, con el sello "Compra verificada" y sumando al
  puntaje que ve Google. El **DNU 274/2019** (arts. 10 a) y 11), el CCyC 1101 y la LDC art. 4 tratan
  la información que puede inducir a error sobre la calidad o la aceptación de un producto. Cuando
  lleguen reseñas reales, conviene reemplazarlas.

## 4. Lo que queda de la auditoría de seguridad

- **Verificación del email de las cuentas (NV-20).** Hoy cualquiera puede crear una cuenta con un
  email que no es suyo (el mail "Cuenta creada" llega a ese email, pero la cuenta funciona sin
  confirmarlo). El registro ya no adopta pedidos de invitado, así que no da acceso a compras
  ajenas; falta el enlace de verificación (necesita un cambio de contrato con el front).
- **Formato del número de pedido (NV-15).** El contrato fija `GLP-` y cinco dígitos: alcanza para
  89.999 pedidos (unos 4 años a 50 por día). Antes de llegar al 80 % (`SELECT last_value FROM
order_number_seq` mayor que 82000) hay que ampliar el formato en el contrato del front y del back.
- **Límites por cliente sin `TRUST_PROXY`.** Ver la tarea de la sección 1: sin el proxy, las cuotas y
  las lecturas públicas no tienen límite por cliente.

## 5. Lo que ya hace el sistema (para no repetirlo)

Lo de la tienda y el dashboard sale con la rama `feat/legal-accesibilidad` del front (en curso);
lo del back ya está en `main`.

- Cuatro textos legales editables desde el dashboard, con los datos del vendedor como marcadores,
  "Última actualización" y botón para imprimir o guardar como PDF.
- Pie con datos del vendedor, Data Fiscal, el enlace de la Ley CABA 2244 con su leyenda y la
  Ventanilla Federal Única.
- Avisos de datos personales en cada formulario, sin casillas obligatorias ni premarcadas.
- Mails de pedido recibido (con el arrepentimiento y los enlaces a términos y devoluciones), pago
  aprobado, despacho, entrega, cancelación o vencimiento, código del arrepentimiento, contacto,
  cuenta creada, restablecer la contraseña y cuenta eliminada. Sin newsletter, sin rastreo.
- Plazos de conservación y purga diaria (ADR 0008): claves de idempotencia 48 h, tokens de
  contraseña 7 días después de vencer, mensajes de contacto 24 meses, eventos técnicos 90 días,
  reseñas no publicadas 12 meses, pedidos y arrepentimientos 10 años.
- Eliminar la cuenta desde la tienda (`DELETE /me`), con los pedidos guardados sin vínculo a la
  cuenta por la obligación de conservar los comprobantes.
- Logs sin la búsqueda ni emails enteros.
