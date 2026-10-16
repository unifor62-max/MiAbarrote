# Usar el teléfono como lector con un enlace de 8 horas

La computadora genera un QR y un enlace. El teléfono abre el lector desde ese enlace y envía los códigos a la venta o compra que esté abierta en la computadora. El lector usa PeerJS: no requiere Redis, variables de entorno ni instalar una aplicación.

## Primera prueba

1. Conecta el teléfono y la computadora a la misma Wi-Fi. Abre la versión publicada de MiAbarrote por HTTPS en la computadora.
2. Inicia sesión y entra a **Ventas → Registrar venta** o **Compras → Registrar compra**.
3. En el primer paso pulsa **Usar teléfono como lector**. Aparecen el QR, el enlace para copiar y la hora de vencimiento.
4. Escanea el QR con el teléfono, o copia el enlace y ábrelo en su navegador. La página móvil no pide iniciar sesión.
5. Cuando la computadora indique **Teléfono conectado**, pulsa **Continuar**. El diálogo del QR pausa la selección mientras está abierto.
6. En el teléfono pulsa **Iniciar cámara** y permite el acceso. Se intenta usar la cámara trasera. Utiliza Chrome Android si el navegador interno de la aplicación que leyó el QR impide abrirla.
7. Escanea un código registrado en el catálogo y espera la confirmación. El producto se selecciona en la computadora y permanece al principio de la lista.

Para una prueba con un envase real, registra su código impreso en el catálogo. Los datos demo incluyen códigos como DEMO-000001 y PACK-000001: un envase con otro código mostrará **Código no encontrado**.

## Qué se conserva durante 8 horas

| Situación | Resultado |
| --- | --- |
| Cerrar el diálogo del QR | El teléfono permanece conectado. |
| Cambiar de venta a compra | Se conserva el enlace; el lector sigue la nueva operación abierta. |
| Avanzar al segundo paso o cerrar la selección | El teléfono queda pausado. |
| Recargar la computadora | El enlace y su vencimiento se conservan. Inicia sesión nuevamente para retomar la conexión. Las ventas e inventario se reinician como antes. |
| Cortar la Wi-Fi | Se intenta reconectar con el mismo enlace; una lectura sin confirmar conserva su identificador mientras la página del teléfono siga abierta. |
| Cerrar sesión o pulsar Desconectar teléfono | Se invalida la vinculación y se necesita un enlace nuevo. |
| Cumplirse 8 horas desde la generación | Se bloquean las lecturas. Genera otro enlace y QR. Reconectar no extiende la duración. |

La vinculación se guarda en localStorage de cada navegador. No se guardan allí ventas, inventario, imágenes ni códigos escaneados. Solo puede conectarse un teléfono a la vez. Una segunda pestaña de computadora no toma la vinculación de la primera: cierra la anterior antes de reintentar.

Un código repetido confirma que el producto ya está seleccionado; no aumenta cantidades ni lo desmarca. **Volver a leer** permite leer nuevamente el mismo código. Un código desconocido o sin stock vendible muestra su aviso correspondiente.

## Conexión y problemas frecuentes

- **Localhost:** un enlace que contiene localhost o 127.0.0.1 apunta al propio dispositivo que lo abre. Para la prueba entre dispositivos usa el despliegue HTTPS de Vercel; la cámara del teléfono necesita un contexto seguro.
- **Esperando computadora:** comprueba que la computadora tenga la aplicación abierta y la sesión iniciada. Abre el primer paso de una venta o compra y cierra el diálogo del QR.
- **No conecta:** comprueba Internet y que ambos equipos estén en la misma Wi-Fi. Las redes de invitados pueden aislar dispositivos. Pulsa **Reintentar conexión** en la computadora o vuelve a abrir el enlace en el teléfono.
- **Otra pestaña:** cierra la pestaña anterior que mantiene la vinculación y reintenta con el mismo enlace.
- **Otro teléfono conectado:** cierra su página para liberar la conexión. Si pulsas **Desconectar teléfono**, se revoca el enlace y debes generar otro.
- **Cámara denegada:** permite el acceso desde los ajustes del sitio. Cierra otras aplicaciones que utilicen la cámara y vuelve a pulsar **Iniciar cámara**.
- **Enlace anterior o vencido:** genera uno nuevo. Los enlaces de la versión antigua basada en Redis no son compatibles.

Esta versión utiliza el servicio público gratuito de señalización de PeerJS y un servidor STUN. Después del enlace, los códigos viajan mediante un canal de datos WebRTC. No se configura TURN: una red que impida la conexión directa puede necesitar un servicio de retransmisión adicional. Véase la [documentación oficial de PeerJS](https://peerjs.com/server/getting-started).

## Publicación y mantenimiento

Vercel conserva la configuración existente: Node 22, instalación con npm ci, compilación con npm run build y salida dist. La ruta /lector se resuelve mediante la navegación SPA. El lector no utiliza funciones /api/lector-*, Redis ni variables VITE_*.

Los servicios de pagos mantienen su configuración independiente. Quitar Redis del lector no elimina las variables que necesite la integración real de pagos.

El QR se genera localmente con qrcode. La cámara se decodifica localmente con ZXing y solo se transmite el código. El secreto de vinculación viaja en el fragmento del enlace y se valida en el canal de datos antes de aceptar lecturas. El teléfono retira el fragmento de la barra tras guardar la vinculación.

Cada lectura tiene identificador y contexto de operación. La computadora conserva temporalmente el resultado para responder reintentos sin repetir la selección. Las lecturas de una operación anterior no se aplican a otra. La caducidad se comprueba al conectar, al leer y mediante temporizadores, sin extender el vencimiento.

Para verificar cambios:

- Ejecuta npm test, npm run typecheck y npm run build.
- Con Vite abierto, visita /tests/remoteScanner.browser.html para las comprobaciones de interfaz con transporte simulado.
- Prueba dos navegadores reales mediante /tests/remoteScanner.browser.html?live=1 para escritorio y el enlace /lector generado para el teléfono; el modo live utiliza PeerJS real y muestra el catálogo demostrativo.
- Para ensayar señalización, envío, pausa y reconexión sin cámara, abre /tests/remoteScanner.browser.html?live=real en un navegador con WebRTC. Este ensayo utiliza el servicio público real y no forma parte de las pruebas simuladas.
- Antes de considerar validado un teléfono físico, prueba el despliegue HTTPS, un código real registrado, su selección en la computadora, la pausa en el paso 2, la reconexión y la desconexión.

Las pruebas simuladas no validan el permiso ni el enfoque de una cámara física. La aplicación conserva su login demostrativo y los datos comerciales permanecen en memoria.

El ensayo del canal real no pudo completarse en el navegador integrado del entorno de trabajo: la página se cerró inesperadamente durante WebRTC. Sigue pendiente la prueba con un teléfono físico y el despliegue HTTPS; no se considera validada por las pruebas simuladas.

El límite de reversión de este cambio es el transporte y la interfaz del lector en src/features/scanner, sus tipos en src/data/remoteScanner.ts, el ciclo de vinculación en App y las pruebas/dependencias exclusivas del lector. Los handlers, almacenamiento y configuración de pagos quedan fuera de ese límite.
