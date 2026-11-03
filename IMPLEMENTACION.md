# BiblioIA: biblioteca, normativa y asistente

## Cambios locales

- Presentación sobria y adaptable, con accesos independientes a Biblioteca, Leyes y Asistente IA.
- Fichas de normativa, búsqueda por título/número/materia y carga de versiones en PDF.
- Conservación de originales y textos por versión. Las versiones son inmutables.
- Comparación textual con la referencia aprobada y aprobación con detección de cambios concurrentes.
- Las normas modificatorias se guardan como respaldo; no reemplazan automáticamente un texto consolidado.
- Un único asistente para documentos, normativa, preguntas generales e imágenes (pegar, arrastrar o adjuntar).
- Recuperación de fragmentos de documentos por coincidencia con la pregunta; se declara explícitamente el alcance parcial.

## Validación local

```powershell
node --check app.js
node --check legislation.js
node --test tests/legislation.test.cjs
python -m http.server 8765 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8765/` para usar la aplicación real. La demostración local en `docs/preview.html` utiliza datos ficticios y no permite guardar datos ni consultar la IA. No debe publicarse como aplicación real.

## Estado de integración

El repositorio local corresponde a `Maah1996/BiblioIA` y al proyecto Firebase `maahia`. No sustituir la configuración de otra aplicación sin una migración explícita.

1. Reglas publicadas y verificadas en `maahia-default-rtdb` el 2 de noviembre de 2026. Las reglas agregan `leyes`, `ley_versiones` y `ley_archivos` y mantienen los permisos existentes de administrador/miembro activo.
2. Código sincronizado en la rama `main` de `Maah1996/BiblioIA`. El alojamiento debe servir juntos `index.html`, `app.js`, `styles.css`, `professional.css` y `legislation.js`.
3. Verificar con una sesión real: crear ficha, guardar PDF, revisar/aprobar, descargar original y consultar texto e imagen.
4. El Worker existente no está incluido en este repositorio: debe aceptar bloques de imagen de la API de mensajes. Formato contrastado con la documentación oficial de Anthropic: https://platform.claude.com/docs/es/build-with-claude/vision.

## Límites actuales

- PDF normativo: 8 MB. Se almacena temporalmente como base64 en un nodo separado de Realtime Database. Para volumen comercial conviene migrar originales a almacenamiento de objetos con reglas y cuotas propias.
- Se requiere PDF con texto; OCR y consolidación automática de modificaciones parciales no están implementados.
- Imágenes: hasta tres PNG/JPEG/WebP de 4 MB cada una. Se usan durante la conversación; no se conservan en el historial persistente.
- Las consultas legales admiten hasta 120.000 caracteres de texto; se rechazan documentos mayores en vez de truncarlos silenciosamente.
- Las fechas de publicación y vigencia son declaradas por el administrador. Aprobar una referencia no equivale a verificar oficialmente su vigencia.
- Sigue pendiente trasladar la clave de IA al servidor. Las reglas actuales solo permiten al administrador leerla; la consulta de IA de miembros necesita esa integración de servidor antes de comercializarse.
- Firebase validó la sintaxis y se verificaron las reglas publicadas mediante una lectura posterior. No se modificaron documentos existentes ni se realizaron consultas reales al proveedor de IA. Ocho pruebas automatizadas pasaron; navegación, comparación y formulario comprobados con datos ficticios.
