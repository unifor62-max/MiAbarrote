# MiAbarrote

Aplicación React + TypeScript para inventario, compras y ventas. Incluye pagos QR, híbridos y efectivo, recepción de notificaciones por MacroDroid y funciones para Vercel y Netlify.

También permite [usar el teléfono como lector de barras](docs/lector-telefono.md) en ventas y compras: la computadora muestra un QR y un enlace reutilizables durante 8 horas. El teléfono se conecta mediante PeerJS, sin Redis ni variables de entorno para el lector, y cada lectura selecciona el producto en la operación abierta.

## Ejecutar y verificar

Requiere Node.js 22.12 o superior dentro de la rama 22.

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

El modo inicial es demostración. Las ventas e inventario se mantienen en memoria y se reinician al recargar.

## Vercel y Yape Bolivia

La raíz del proyecto es esta carpeta. `vercel.json` fija instalación con `npm ci`, compilación Vite, salida `dist` y navegación SPA sin interceptar `/api/`. Las funciones requieren variables privadas de servidor y Upstash Redis.

Los pagos se conectan automáticamente, sin clave de caja. Sigue la [guía paso a paso actualizada](docs/configurar-yape-vercel-macrodroid.md). El [PDF original](output/pdf/Guia-MacroDroid-Vercel-MiAbarrote.pdf) conserva pasos de conexión manual que ya no son necesarios. La guía diferencia el ejemplo de notificación del formato real de Yape que debes comprobar en tu teléfono.

Consulta también el [contrato técnico de pagos](docs/pagos-macrodroid.md). Copia únicamente los nombres de variables de `.env.example`: nunca publiques claves ni archivos `.env.local`.
