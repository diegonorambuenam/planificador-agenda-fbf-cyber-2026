/**
 * Bound to the PRIVATE source spreadsheet. No secrets or real IDs in source.
 * Set Script Properties: SUPABASE_URL, SUPABASE_PUBLIC_KEY, FBF_SYNC_KEY,
 * SOURCE_SHEET_ID (numeric gid of the extract, not the preview).
 * Reads the existing extract only. NEVER executes a BigQuery refresh.
 * @OnlyCurrentDoc
 */
const FBF_EVENT = 'cyber-octubre-2026';
const FBF_COLUMNS = ['creado','seller_id','seller','node_id','fecha_envio','estado','number','units','fecha_ini','fecha_fin'];

function sincronizarSolicitudes() {
  const started = Date.now();
  let stage = 'inicio';
  function mark(next) {
    stage = next;
    console.log('FBF etapa=' + stage + ' ms=' + (Date.now()-started));
  }
  mark('bloqueo');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { mark('otra_ejecucion_activa'); return; }
  mark('propiedades');
  const properties = PropertiesService.getScriptProperties();
  try {
    const config = properties.getProperties();
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.SUPABASE_URL || '') ||
        !config.SUPABASE_PUBLIC_KEY || !/^[a-f0-9]{64}$/.test(config.FBF_SYNC_KEY || '') ||
        !/^\d+$/.test(config.SOURCE_SHEET_ID || '')) throw new Error('Configuracion incompleta');
    mark('abrir_documento');
    const book = SpreadsheetApp.getActiveSpreadsheet();
    mark('buscar_hoja');
    const sheet = book.getSheets().find(item => String(item.getSheetId()) === config.SOURCE_SHEET_ID);
    if (!sheet) throw new Error('No existe la hoja de extraccion configurada');
    mark('leer_tablas_conectadas');
    const tables = sheet.getDataSourceTables();
    if (tables.length !== 1) throw new Error('Se requiere un unico extracto de Connected Sheets');
    const table = tables[0];
    mark('estado_extracto');
    const status = table.getStatus();
    if (status.getExecutionState() !== SpreadsheetApp.DataExecutionState.SUCCESS || status.isTruncated()) {
      throw new Error('Extraccion no actualizada correctamente; se conservan los datos anteriores');
    }
    const refreshed = status.getLastRefreshedTime();
    if (!refreshed || Date.now()-refreshed.getTime()>3*60*60*1000) throw new Error('Extraccion desactualizada');
    const sourceTime = refreshed.toISOString();
    if (config.LAST_SUCCESS_REFRESH === sourceTime) { mark('sin_cambios'); return; }
    mark('rango_extracto');
    const range = table.getRange();
    if (range.getNumRows()>25001 || range.getNumColumns()>100) throw new Error('Extraccion demasiado grande');
    mark('leer_valores');
    const displayed = range.getDisplayValues();
    mark('validar_filas');
    const headers = displayed[0].map(value => value.trim().toLowerCase());
    if (headers.some(value => !value) || new Set(headers).size !== headers.length ||
        FBF_COLUMNS.some(name => !headers.includes(name))) throw new Error('Columnas invalidas');
    const rows = displayed.slice(1).filter(row => row.some(value => value.trim()))
      .map(row => Object.fromEntries(headers.map((name,index) => [name,row[index]])));
    // Reaching the configured row limit may mean truncation: fail closed.
    const limit = table.getRowLimit();
    if (!rows.length || (limit !== null && rows.length >= limit)) throw new Error('Extraccion vacia o posiblemente truncada');
    const numbers = rows.map(row => row.number.trim());
    if (numbers.some(value => !value || value.length>200) || new Set(numbers).size!==numbers.length)
      throw new Error('Numbers vacios o duplicados; revisar la fuente');
    mark('revalidar_extracto');
    const after = table.getStatus();
    if (after.getExecutionState() !== SpreadsheetApp.DataExecutionState.SUCCESS || after.isTruncated() ||
        after.getLastRefreshedTime().toISOString() !== sourceTime) throw new Error('La fuente cambio durante la lectura');
    const payload = JSON.stringify({p_event_id:FBF_EVENT,p_source_refreshed_at:sourceTime,p_rows:rows});
    if (Utilities.newBlob(payload).getBytes().length>4500000) throw new Error('Carga demasiado grande');
    mark('enviar_supabase');
    const response = UrlFetchApp.fetch(config.SUPABASE_URL+'/rest/v1/rpc/fbf_ingest_requests', {
      method:'post',contentType:'application/json',payload:payload,
      headers:{apikey:config.SUPABASE_PUBLIC_KEY,'x-fbf-sync-key':config.FBF_SYNC_KEY},
      muteHttpExceptions:true,followRedirects:false,validateHttpsCertificates:true
    });
    console.log('FBF HTTP=' + Number(response.getResponseCode()));
    mark('validar_respuesta');
    if (response.getResponseCode()!==200) throw new Error('Supabase rechazo la sincronizacion (HTTP '+response.getResponseCode()+')');
    const result = JSON.parse(response.getContentText());
    if (result.ok!==true || result.rows!==rows.length) throw new Error('Respuesta inesperada');
    mark('guardar_confirmacion');
    properties.setProperties({LAST_SUCCESS_REFRESH:sourceTime,LAST_SUCCESS_AT:new Date().toISOString(),LAST_ROW_COUNT:String(rows.length),LAST_ERROR:''});
    mark('completado');
  } catch (error) {
    // Never log payloads, response bodies, keys, seller data or credentials.
    console.log('FBF fallo_etapa=' + stage + ' ms=' + (Date.now()-started));
    properties.setProperty('LAST_ERROR_AT',new Date().toISOString());
    properties.setProperty('LAST_ERROR','No se completo la sincronizacion. Revisar extraccion, configuracion y acceso.');
    throw new Error('Sincronizacion FBF no completada. Se conserva la ultima copia correcta.');
  } finally { lock.releaseLock(); }
}

function instalarSincronizacion() {
  // Idempotent; never remove unrelated triggers.
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction()==='sincronizarSolicitudes');
  if (!existing.length) ScriptApp.newTrigger('sincronizarSolicitudes').timeBased().everyMinutes(15).create();
}
