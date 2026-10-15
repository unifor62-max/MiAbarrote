# Cobrar con QR, efectivo o ambos

El cajero elige el método en el segundo paso de la venta. MacroDroid envía la notificación bancaria al buzón, el modal valida el importe y el cajero pulsa **Confirmar**. La venta y el descuento de stock ocurren una sola vez en la sesión del prototipo.

## Probar sin servicios externos

1. Ejecuta `npm run dev`. El modo predeterminado es `demo`.
2. Abre Ventas → Registrar venta, selecciona productos y pulsa Siguiente.
3. Elige QR o Híbrido y pulsa **Simular envío MacroDroid**. QR simula el total; Híbrido simula aproximadamente la mitad.
4. Comprueba el toast superior, el desglose y el botón Confirmar. Abre el comprobante con el ícono del ojo después de registrar la venta.

Desde la consola del navegador también puedes ejecutar:

```js
window.simularPagoQR("Ana Pérez", 150.50)
```

Esta función solo existe mientras el usuario tiene abierta una sesión del prototipo en modo `demo`. Una notificación recibida con el modal cerrado, en el primer paso o en modo Efectivo muestra el toast, pero no se aplica después a otra venta. El simulador usa BroadcastChannel y reservas con Web Locks/localStorage para coordinar pestañas del mismo origen; no transmite estos datos a Redis.

## Configurar recepción real

Prepara una base Upstash Redis existente y configura estas variables en el hosting. Copia `.env.example` a `.env.local` únicamente para pruebas locales; no publiques ese archivo.

| Variable | Valor y uso |
|---|---|
| `VITE_PAYMENT_MODE` | `cloud` activa recepción real y elimina el simulador. Requiere reconstruir el frontend. |
| `UPSTASH_REDIS_REST_URL` | URL HTTPS REST de Redis. Solo servidor. |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis con permisos de lectura y escritura. Solo servidor. |
| `PAYMENT_WEBHOOK_KEY` | Clave aleatoria para MacroDroid, de al menos 32 caracteres. |
| `PAYMENT_READER_KEY` | Ya no se utiliza en la conexión automática del prototipo. Puede eliminarse del entorno. |
| `PAYMENT_SESSION_SECRET` | Clave aleatoria distinta, de al menos 32 caracteres, para firmar sesiones. |
| `PAYMENT_NAMESPACE` | Prefijo exclusivo para este entorno, por ejemplo `miabarrote-produccion`. Separa producción y previews. |

Las claves y credenciales Redis nunca deben llevar prefijo `VITE_`: ese prefijo publica el valor en el navegador. Usa claves aleatorias distintas; cambia la clave del webhook si el teléfono deja de estar autorizado.

### Vercel

Importa esta carpeta como proyecto Vite. `vercel.json` configura `npm run build`, salida `dist` y rutas SPA. Las funciones de `api/` sirven `/api/webhook-pago`, `/api/pagos-sesion` y `/api/pagos-estado`. Configura las variables anteriores antes de construir.

### Netlify

Importa esta carpeta como proyecto. `netlify.toml` configura el mismo build y salida; los adaptadores en `netlify/functions/` publican las mismas rutas `/api/`. Usa runtime Node.js 22 o superior. La configuración de rutas de las funciones tiene prioridad sobre el fallback de la SPA.

Las dos plataformas comparten los handlers de `server/`. Redis se accede mediante su [API REST oficial](https://upstash.com/docs/redis/features/restapi), sin servidor permanente ni conexión TCP.

### Conectar la caja

El prototipo conecta pagos automáticamente al abrir la aplicación autenticada. Ya no hay formulario ni clave de caja. El servidor emite una cookie firmada, HttpOnly, Secure, SameSite=Strict y con ocho horas de vigencia, que el listener renueva automáticamente cuando expira. El estado se muestra en Ventas. El login general continúa siendo demostrativo.

Por decisión del equipo, cualquier visitante que acceda al prototipo puede obtener esta sesión y consultar/asociar notificaciones. La cookie mantiene la identidad de las reservas, pero no restringe el acceso al equipo. El endpoint de sesión comprueba el origen y limita solicitudes; el POST de MacroDroid sigue exigiendo `PAYMENT_WEBHOOK_KEY`. No hay secretos de servidor en el frontend.

La primera consulta establece el punto de inicio y no recupera transferencias anteriores a la conexión. Después, el listener consulta cada dos segundos, conserva su cursor durante fallos de red y reintenta hasta cada 30 segundos. Si la sesión expira, se renueva automáticamente sin descartar el cursor; los errores de red se reintentan con espera progresiva. Las consultas son de un mismo origen y no permiten CORS abierto.

## Configurar HTTP Request en MacroDroid

Captura la notificación de la aplicación bancaria y extrae titular e importe. Envía los siguientes valores:

| Campo | Configuración |
|---|---|
| Método | `POST` |
| URL | `https://TU-DOMINIO/api/webhook-pago` |
| Encabezado | `Content-Type: application/json` |
| Autorización | `Authorization: Bearer VALOR_DE_PAYMENT_WEBHOOK_KEY` |
| Cuerpo | JSON con titular, monto numérico en Bs y timestamp ISO con zona horaria. |

```json
{
  "id": "notificacion-bancaria-000001",
  "titular": "Ana Pérez",
  "monto": 150.50,
  "timestamp": "2026-10-13T21:00:00-04:00"
}
```

`id` es opcional, pero se recomienda generarlo una vez por notificación y conservarlo durante reintentos. Sin él, se deduplica por titular, importe y timestamp: dos transferencias con los tres valores idénticos se consideran la misma notificación. No envíes el monto como texto con `Bs`, separadores de miles ni más de dos decimales.

Una recepción nueva responde `201`; un reintento idéntico responde `200` con `duplicate: true`. Un mismo ID con datos distintos responde `409`. Reintenta errores de red y `503` conservando el payload; respeta `Retry-After` en `429`. No reintentes errores de formato o autorización sin corregirlos.

## Cómo se valida el cobro

| Método | Regla |
|---|---|
| Efectivo | QR = 0; efectivo = total. |
| QR | Requiere notificación reservada con importe exactamente igual al total; no admite edición manual. |
| Híbrido automático | QR recibido debe ser menor al total; efectivo = total − QR. Ambos deben ser positivos. |
| Híbrido manual | Ambos campos editables, positivos y suma exacta. El comprobante indica contingencia manual. |

El primer pago válido queda asociado al modal. Los siguientes aparecen en la cola de toasts sin sustituirlo. **Cambiar pago**, cambiar el método o cancelar libera la reserva y vuelve a esperar una notificación nueva. Editar el desglose híbrido libera la evidencia automática y pasa a registro manual.

Redis conserva eventos y asociaciones por 24 horas. Una reserva dura cinco minutos y se renueva cada minuto mientras el modal está abierto. Confirmar consume la reserva con una clave idempotente; una respuesta perdida puede reintentarse desde el mismo modal sin consumir dos veces. Durante la confirmación se bloquean edición, cierre y nuevas mutaciones del POS. Ante un error no se registra la venta ni se descuenta stock.

Cancelar intenta liberar la reserva antes de cerrar. Si la red está caída o la sesión expiró, igualmente permite salir para reconectar; la reserva vence en un máximo de cinco minutos. El cierre permanece bloqueado mientras una confirmación está en curso.

## Límites y comprobación

Las ventas, productos e inventario siguen en memoria y se reinician al recargar. Redis conserva la notificación consumida aunque se pierda el POS local: cerrar o recargar después de consumir una transferencia puede dejar una notificación consumida sin comprobante recuperable. No existe una transacción distribuida entre Redis y el estado del navegador. Persistir el POS y conciliar con la API bancaria requiere una fase adicional.

El webhook acredita que MacroDroid envió una notificación; no verifica la transferencia directamente con el banco. Para esta versión usa una sola caja. Las reservas evitan que dos pestañas apliquen el mismo evento, pero el payload no identifica una venta: dos cobros simultáneos con el mismo importe requieren identificación adicional.

- Ejecuta `npm test`, `npm run typecheck` y `npm run build`.
- Abre `/tests/payments.browser.html` para verificar wizard, pagos, cancelación y comprobantes.
- En el despliegue configurado, espera el estado de caja conectada, deja el paso 2 abierto y envía un POST real con un monto incorrecto y después uno correcto.
- Prueba reenvío del mismo ID y segundo pago: un pago consumido no puede aplicarse a una nueva venta.
- Nunca añadas claves, titulares reales o payloads bancarios a logs o al repositorio.

La unidad de cambio comprende el modelo de pagos, el flujo de ventas, el listener, los handlers y sus adaptadores, pruebas y esta guía. Para revertirla, retirar esas incorporaciones y restaurar las interfaces de venta previas; no revertir los cambios de navegación de Inventario.

## Evidencia de verificación local

| Comprobación | Resultado |
|---|---|
| `node --test tests/payments.test.mjs tests/paymentApi.test.mjs tests/paymentListener.test.mjs` | 19 pruebas aprobadas del modelo, handlers y listener. |
| Suite completa `npm test` | 124 pruebas aprobadas. |
| `/tests/payments.browser.html` | 8/8: métodos de pago, discrepancias, reserva, contingencia manual, cancelación, error de consumo y doble confirmación. |
| `/tests/productSelection.browser.html` | 8/8: pinning y escáner de ventas y compras. |
| `npm run typecheck` y `npm run build` | Correctos. |
| Modal a 390 px | Página y dialog sin desbordamiento horizontal; campos y acciones se apilan. |

Los handlers se verificaron con un buzón de prueba y el transporte REST con respuestas controladas. No se crearon servicios, no se desplegó y no se ejecutaron los scripts Lua contra un Redis real. La prueba integrada de MacroDroid → Redis → navegador queda pendiente de configurar las credenciales del entorno.
