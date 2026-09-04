# Solicitudes privadas desde Connected Sheets

Código genérico: no colocar datos de sellers, IDs del documento ni claves en el repositorio.

## Instalación (administrador)

1. Ejecutar `supabase/migrations/003_sheet_requests.sql` en el SQL Editor privado, después de 002.
2. En el SQL Editor, generar una clave mediante `select private.issue_fbf_sync_key('cyber-octubre-2026');`. Copiarla directamente a las propiedades privadas del script. No guardar el resultado en archivos, mensajes, capturas ni GitHub. Ejecutar de nuevo rota la clave y desactiva la anterior.
3. Desde el documento restringido, abrir Extensiones → Apps Script. Añadir `Code.gs` sin reemplazar código existente no relacionado.
4. En Configuración del proyecto → Propiedades del script definir `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY` (anon/publishable, nunca service_role), `FBF_SYNC_KEY` y `SOURCE_SHEET_ID` (gid del extracto, no la vista previa).
5. El propietario autoriza y ejecuta `sincronizarSolicitudes`. Comprobar `LAST_ROW_COUNT` y `LAST_SUCCESS_AT` en propiedades; comprobar la copia en Supabase.
6. Ejecutar `instalarSincronizacion` para instalar un único activador cada 15 minutos. Mantener el refresco horario existente de Connected Sheets. El script NO ejecuta consultas BigQuery.
7. Publicar el frontend después de verificar el primer envío y los permisos.

Solo los editores de confianza deben acceder al documento/script: pueden leer sus propiedades. La clave de envío permite reemplazar datos de origen de este evento; no leer usuarios ni modificar capacidades. Si se filtra, rotarla y actualizar las propiedades. No publicar el documento en la web.

## Comportamiento y límites

- Conserva todas las columnas y valores mostrados. No elimina registros que desaparecen: los marca ausentes para revisión.
- Identifica solicitudes por `number` único. Un extracto vacío, duplicado, sin clave o posiblemente truncado rechaza todo el envío y mantiene la última copia. No corrige datos en Sheets.
- Guarda `fecha_ini`/`fecha_fin` como ventana, y `fecha_envio` como referencia, incluso fuera de horizonte. Las unidades inválidas no se suman y se muestran como faltantes; su valor original se conserva en `source_row`.
- Acepta hasta 25.000 filas en el servidor; el script rechaza alcanzar el límite configurado del extracto por posible truncamiento. Límite de carga del script: 4,5 MB. Revisar diseño antes de superar estos límites.
- Solo envía tras un refresco exitoso nuevo. Rechaza extractos de más de 3 horas. El frontend avisa a las 2 horas y consulta Supabase cada minuto, sin tocar BigQuery. La latencia incluye el refresco horario y hasta 15 minutos adicionales del activador.
- Solicitudes y capacidades son compartidas. Agenda manual, prioridades, comentarios e historial siguen en IndexedDB de cada navegador; no son todavía colaborativos.
- Al combinar la fuente se conservan decisiones manuales y registros locales antiguos; estos últimos se marcan para revisión si no aparecen en la extracción.
- Si falla, revisar ejecución de Apps Script y propiedades LAST_ERROR/LAST_ERROR_AT, sin registrar claves ni cargas. LAST_SUCCESS_AT puede ser anterior: no equivale a una prueba de que el último intento funcionó.

## Seguridad/verificación

Sin sesión no debe poder leerse el snapshot; con sesión ajena al equipo tampoco. Las tablas no tienen acceso directo para anon/authenticated. El RPC de ingesta requiere la clave privada y no se concede a authenticated. La función generadora de claves no es accesible desde la API pública.

No se ha completado una instalación solo por compilar: verificar ejecución real, fila contada, fechas, lectura autorizada, rechazo sin clave y despliegue. No incluir datos reales en fixtures.
