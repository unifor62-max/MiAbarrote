# Usar tu teléfono como lector de barras

Abre MiAbarrote en la laptop, vincula el teléfono con el QR y escanea los envases desde el navegador del teléfono. Sirve en el primer paso de ventas y compras. No requiere instalar aplicaciones ni programas en Windows.

## Primera prueba

1. En la laptop abre [MiAbarrote](https://mi-abarrote.vercel.app/), inicia sesión y entra a **Ventas → Registrar venta** o **Compras → Registrar compra**.
2. En el primer paso pulsa **Usar teléfono como lector**. Aparece un QR válido durante dos minutos.
3. En el teléfono usa la cámara o la opción de leer QR y abre el enlace. Comprueba que pertenece al mismo sitio de MiAbarrote. La página del lector no pide el login demostrativo.
4. En la laptop, cuando indique **Teléfono conectado**, pulsa **Continuar** para cerrar el diálogo del QR. Con el diálogo abierto la selección permanece pausada.
5. En el teléfono pulsa **Iniciar cámara** y permite el acceso. Se solicita preferentemente la cámara trasera. Abre el enlace en Chrome Android si la aplicación que leyó el QR tiene un navegador interno que impide utilizar la cámara.
6. Apunta al código de barras de un producto **registrado en el catálogo**. Deja margen blanco alrededor, buena luz y enfoca a unos 15–25 cm; ajusta la distancia hasta que se lea.
7. Espera la confirmación en el teléfono. El producto debe aparecer seleccionado y fijado al principio de la lista en la laptop. Un código desconocido muestra un aviso; no crea productos automáticamente.

Los datos demostrativos usan códigos como `DEMO-000001` y `PACK-000001`. El código impreso en un envase real solo encontrará el producto si ese mismo código fue registrado en el catálogo. Para la primera prueba puedes registrar el código real de un producto desde la gestión de productos, o mostrar una etiqueta Code 128 que contenga uno de los códigos demostrativos.

La selección suele confirmarse en unos segundos, dependiendo de la red. El teléfono muestra éxito después de recibir la confirmación de la laptop. Las imágenes de la cámara no salen del teléfono; solo se transmite el código.

## Qué sucede al escanear

| Situación | Resultado |
| --- | --- |
| Producto conocido | Se selecciona y queda fijado al principio del catálogo. |
| Producto ya seleccionado | Se confirma la selección; conserva cantidades y presentación. |
| Código de paquete | Selecciona el producto correspondiente. La presentación se configura en el segundo paso. |
| Código desconocido | Aparece un aviso en ambos dispositivos. |
| Venta sin stock vendible | Se informa del problema y no se selecciona el producto. |
| Mismo código sostenido ante la cámara | Se evita enviarlo continuamente. Usa **Volver a leer** o apunta a otro código para habilitar otra lectura. |
| Paso 2, diálogo superpuesto o pestaña de laptop oculta | El lector queda pausado. |
| Cancelar o terminar la operación | Conserva la vinculación; abre la siguiente venta o compra para seguir. |
| Desconectar, cerrar sesión o recargar laptop | Hace falta un nuevo QR. Cerrar la pestaña deja caducar la sesión en un máximo de 60 segundos. |
| Recargar teléfono | Recupera la vinculación desde esa pestaña, si la laptop sigue conectada; pulsa otra vez **Iniciar cámara**. |

Puedes mantener el lector USB y la entrada manual. El lector del teléfono no necesita que ambos dispositivos estén en la misma Wi-Fi: ambos necesitan internet. Se admite un teléfono por pestaña de laptop; otra pestaña crea una vinculación independiente.

## Resolver problemas

| Mensaje o síntoma | Qué hacer |
| --- | --- |
| QR vencido | Pulsa **Generar QR** en la laptop y abre el nuevo enlace. |
| Ya hay otro teléfono vinculado | Desconecta la vinculación anterior desde la laptop y genera otro QR. |
| Lector pausado | Cierra el diálogo del QR y deja visible el primer paso de venta o compra en la laptop. |
| Permiso de cámara denegado | En Chrome abre los permisos de este sitio, permite Cámara y vuelve a pulsar **Iniciar cámara**. |
| No se puede abrir cámara | Cierra otras aplicaciones que la usen. Usa HTTPS; una dirección local HTTP de la laptop normalmente no permite cámara en el teléfono. |
| Código desconocido | Compara el código registrado del producto/paquete con los dígitos del envase, incluidos ceros iniciales. |
| Esperando confirmación | No acumules escaneos. Revisa internet y vuelve al primer paso. Si se agotó la sesión, vincula de nuevo. |
| Configura Redis o lector no disponible | Revisa las variables privadas y disponibilidad de Upstash descritas abajo. |

Las lecturas pendientes pertenecen a una selección concreta. Al cambiar de operación o regresar al paso 1 se crea otro contexto; una lectura antigua se descarta y debe repetirse.

## Configuración en Vercel y Netlify

El lector reutiliza las variables privadas ya utilizadas por los pagos:

| Variable | Uso |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Dirección HTTPS de la API REST de Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Token privado con permisos de lectura/escritura y ejecución de scripts. |
| `PAYMENT_NAMESPACE` | Separa producción y entornos de pruebas; por defecto `miabarrote`. |

No hay nuevas claves que el cajero deba copiar. Las claves de MacroDroid y sesión de pagos son independientes. Nunca copies tokens Redis en variables `VITE_*`, URLs o código del navegador.

**Vercel:** conserva la raíz actual del proyecto, Node 22, instalación `npm ci`, compilación `npm run build` y salida `dist`. El repositorio contiene las funciones `/api/lector-sesion` y `/api/lector-eventos` y la regla que envía `/lector` a la aplicación. Si Redis ya funciona en pagos, no necesitas crear otro servicio. Tras cambiar variables, despliega otra vez para aplicarlas; comprueba que estén disponibles en **Production**. Los previews deben utilizar otro namespace.

**Netlify:** el archivo `netlify.toml` conserva Node 22, compilación/salida y `netlify/functions`. Las dos funciones usan la misma API pública, con rutas declaradas en cada adaptador. Añade las tres variables privadas al entorno de Functions y vuelve a desplegar. El manejo de la API se comparte con Vercel y el servidor local.

**Desarrollo local:** copia `.env.example` a `.env.local`, completa únicamente las variables privadas necesarias y ejecuta `npm run dev`. No publiques ese archivo. El servidor Vite usa los mismos handlers. Para probar la cámara desde otro dispositivo necesitas servir la página mediante HTTPS; la verificación más sencilla es el despliegue de Vercel.

No hay licencia ni cupo artificial por lectura. Las consultas generan consumo en el alojamiento y en Redis: laptop cada segundo durante selección y teléfono cada dos segundos; el latido se mantiene cada 15 segundos. Los errores introducen espera progresiva hasta 30 segundos. Una sesión deja de aceptar lecturas tras más de 30 segundos sin latido y caduca tras 60. Desconectar elimina sus claves y detiene las consultas. Un QR sin utilizar también detiene la vinculación al vencer. [Vercel Hobby está destinado a uso personal no comercial](https://vercel.com/docs/limits/fair-use-guidelines); para operar comercialmente la tienda elige un plan o alojamiento permitido.

## Contrato y mantenimiento

`POST /api/lector-sesion` acepta `create`, `pair`, `heartbeat` y `close`; `GET` devuelve el estado. `POST /api/lector-eventos` acepta `scan` y `result`; `GET` consulta el buzón y, con `eventId`, un resultado. Fuera de `create` y `pair`, se exige `sessionId` en la consulta y la credencial en `Authorization: Bearer …`. Los POST deben proceder del mismo origen y tener JSON de hasta 8 KB. Las respuestas no se almacenan en caché.

La laptop recibe una credencial de propietario y un secreto de vinculación de un solo uso. El secreto viaja en el fragmento `#…` del QR, que no se envía al servidor al navegar y se retira de la barra al abrir el lector. El teléfono genera su propia credencial antes de reclamar el enlace, permitiendo reintentar la misma vinculación si se pierde una respuesta. Redis guarda huellas SHA-256 de las credenciales. La credencial de laptop solo vive en memoria y la de teléfono en `sessionStorage`.

Las claves `scanner:{namespace}:…` están separadas de los pagos. Un script Lua realiza de forma atómica vinculación, actualización de contexto, inserción y acuse. El hash de resultados conserva la deduplicación durante toda la sesión y comparte su caducidad. Los códigos se conservan como cadenas de 1–128 caracteres, incluidos sus ceros iniciales. Se admite una sola lectura pendiente y el teléfono reintenta su mismo identificador tras una respuesta perdida. El cliente de laptop conserva además el resultado de la aplicación local para no repetirla si falla el acuse.

La página móvil carga `@zxing/browser` de forma diferida para EAN-13, EAN-8, UPC-A, UPC-E y Code 128. La laptop genera el QR con `qrcode`; no usa un servicio externo. [Documentación ZXing](https://github.com/zxing-js/browser), [funciones Vercel](https://vercel.com/docs/functions/runtimes/node-js), [funciones Netlify](https://docs.netlify.com/build/functions/api/).

La aplicación sigue siendo un prototipo público con login demostrativo: la vinculación autoriza un canal de lectura y no sustituye una autenticación real del POS. Ventas e inventario permanecen en memoria; esta función no añade persistencia.

## Verificación del equipo

Ejecuta `npm test`, `npm run typecheck` y `npm run build`. Las pruebas de transporte ejecutan el script Lua de producción en un intérprete local, incluyendo vencimiento, dos teléfonos, reintentos, deduplicación, desconexión y Redis caído. Los adaptadores Vercel y Netlify se compilan y comparan sin credenciales. Con Vite abierto, visita `/tests/remoteScanner.browser.html` para la integración visual controlada y `/tests/productSelection.browser.html` para la regresión de selección manual y USB; estas páginas de prueba no forman parte de `dist`.

`fengari` es una dependencia exclusiva de pruebas. Su dependencia `sprintf-js` tiene un aviso moderado sin versión corregida al comprobar esta implementación; solo se ejecutan scripts Lua propios, sin formatos proporcionados por usuarios. No se incluye en la aplicación ni en las funciones del servidor. Comprueba por separado `npm audit --omit=dev` para las dependencias publicadas.

Antes de dar por validado un teléfono concreto, realiza la primera prueba con Chrome Android y una etiqueta real: permiso de cámara, selección en laptop, repetición sin cambiar cantidad, pausa al ir al paso 2, reanudación y desconexión. La simulación de red y las comprobaciones de navegador no sustituyen esta prueba con la cámara física.

Para revertir esta incorporación se retiran los componentes `src/features/scanner`, sus integraciones en ventas/compras y App/main, los handlers/adaptadores de lector y sus dependencias/pruebas. Las rutas y el almacenamiento de pagos permanecen independientes.
