# Guía Técnica de Arquitectura: Plugin `sync.md Multi`

## 1. Introducción a la Nueva Arquitectura

El plugin `sync.md Multi` representa una evolución significativa del plugin `sync.md` original, transformándolo de una solución de sincronización de un solo proyecto a una plataforma robusta capaz de gestionar múltiples vinculaciones (`bindings`) entre proyectos de Super Productivity y archivos Markdown. Esta guía técnica profundiza en los cambios arquitectónicos clave que permiten esta funcionalidad multi-proyecto.

La principal motivación para esta refactorización fue eliminar la limitación de una única configuración global, introduciendo un modelo basado en sesiones que aísla el estado de sincronización para cada vinculación individual. Esto mejora la escalabilidad, la fiabilidad y la experiencia del usuario.

## 2. Modelo de Datos Multi-Proyecto (`local-config.ts`)

El corazón de la nueva arquitectura reside en el modelo de datos de configuración, definido en `src/background/local-config.ts`. Se ha introducido una nueva estructura para almacenar múltiples vinculaciones:

```typescript
export interface SyncBindingCfg {
  id: string;        // Identificador único para la vinculación
  filePath: string;  // Ruta absoluta al archivo Markdown
  projectId: string; // ID del proyecto de Super Productivity
  enabled: boolean;  // Indica si la vinculación está activa
}

export interface LocalUserCfgV2 {
  version: 2;                 // Versión del esquema de configuración
  bindings: SyncBindingCfg[]; // Array de todas las vinculaciones configuradas
}
```

Unos cuantos campos con prefijo `_` se persisten **junto a** las vinculaciones pero se mantienen fuera del array `bindings` a propósito, de modo que actualizarlos nunca cambia el JSON de bindings que compara `applyConfigFromUi()` (lo que provocaría un reinicio completo del registro de sincronización): `_cachedProjects` (lista de id/título de proyectos para el desplegable del iframe), `_lastSynced` (hora del último sync correcto por vinculación, y a la vez el discriminador de "¿ha sincronizado alguna vez esta vinculación?"), y los del notificador de auto-actualización `_lastUpdateCheck` / `_latestVersion` / `_latestUrl`. Todos ellos son **historial local del dispositivo**, no configuración compartida.

### Almacenamiento local del dispositivo (v0.4.0)

Toda la configuración se almacena **localmente en el dispositivo** en el propio `localStorage` del contexto de background (`loadLocalConfig()` / `saveLocalConfig()`, clave `'sync-md-multi-config'`, deliberadamente distinta de la clave `'sync-md-config'` del `sync.md` integrado). **Nunca** se persiste mediante `PluginAPI.persistDataSynced`. Esto es intencionado: `persistDataSynced` lo sincroniza Super Productivity entre los dispositivos del usuario, de modo que una ruta de archivo absoluta configurada en el dispositivo A se activaría en el dispositivo B — y, ejecutada contra una copia obsoleta de un `.md` sincronizado por archivos (Dropbox/Syncthing/iCloud) o contra un archivo coincidente en la misma ruta, podría borrar tareas y propagar los borrados de vuelta. El `localStorage` en Electron está en disco y es por dispositivo, así que las vinculaciones se quedan en la máquina que las creó. Cada dispositivo configura sus propias vinculaciones (una ruta absoluta no tiene sentido en otro dispositivo de todos modos). Una **migración única** en el primer arranque de v0.4.0 siembra el almacén local a partir de cualquier blob sincronizado previo a 0.4.0 y luego borra ese blob para que deje de circular por la sincronización (ver *Lógica de Migración* más abajo).

### Lógica de Migración

Para asegurar la compatibilidad hacia atrás, `loadLocalConfig()` incluye una lógica de migración. Si se detecta una configuración antigua (V1, que carece de `version` o `bindings` y tiene `filePath`), se convierte automáticamente a una `LocalUserCfgV2` con una única vinculación por defecto. Esto garantiza que los usuarios existentes no pierdan su configuración al actualizar el plugin.

Una segunda migración, la **migración única del blob sincronizado**, se ejecuta en el arranque en `background.ts` al actualizar desde una release previa a 0.4.0. `currentConfig` se carga desde `localStorage`; si está vacío, el background lee el blob sincronizado heredado vía `loadSyncedData()` y — solo cuando el almacén local no tiene vinculaciones — lo siembra a partir de ese blob. Luego llama a `persistDataSynced('')` para borrar el blob sincronizado, de modo que la configuración deje de circular entre dispositivos. El sembrado es deliberadamente conservador: en un dispositivo que no creó una vinculación no debe tratar una ruta coincidente como autoritativa; para un único dispositivo es simplemente un re-sembrado único de su propia configuración. Los permisos `persistDataSynced` / `loadSyncedData` se mantienen en `manifest.json` **exclusivamente** para esta migración.

## 3. Gestor de Sincronización Multi-Instancia (`sync-manager.ts`)

El antiguo `sync-manager.ts` ha sido reemplazado por un `SyncRegistry` centralizado que orquesta múltiples `SyncSession`s. Cada `SyncSession` es una instancia independiente que gestiona el ciclo de vida de una única vinculación `SyncBindingCfg`.

### `SyncSession` Interface

```typescript
export interface SyncSession {
  config: SyncBindingCfg;
  stopWatcher: (() => void) | null; // Función para detener el watcher de archivos de esta sesión
  syncInProgress: boolean;          // Bandera para evitar sincronizaciones concurrentes
  mdToSpDebounceTimer: ReturnType<typeof setTimeout> | null;
  spToMdDebounceTimer: ReturnType<typeof setTimeout> | null;
  lastMdToSpSyncTimestamp: number;  // Marca de tiempo de la última sincronización MD -> SP
  pendingMdToSpSync: boolean;       // Indica si hay una sincronización MD -> SP pendiente
  lastSyncedContentHash: string | null; // Fingerprint de contenido al final de la última sync exitosa; syncAllNow lo compara con el hash actual del fichero para detectar una edición sin sincronizar (basado en contenido, no en mtime)
  hasSyncedBefore: boolean;         // True una vez que esta vinculación ha sincronizado al menos una vez (sembrado desde el mapa persistido _lastSynced); distingue una vinculación nueva de una cuyo fichero fue borrado
}
```

### `initSyncRegistry`

La función `initSyncRegistry(bindings: SyncBindingCfg[])` es el punto de entrada para inicializar el sistema de sincronización. Realiza las siguientes acciones:

1.  **Disposición de Sesiones Anteriores**: Llama a `disposeAllSessions()` para limpiar cualquier `SyncSession` y `file-watcher` activos, asegurando un estado limpio.
2.  **Seguimiento de Foco de Ventana**: Configura el seguimiento del foco de la ventana de Super Productivity una única vez.
3.  **Inicialización de Sesiones**: Itera sobre el array `bindings` proporcionado, iniciando una `SyncSession` para cada vinculación habilitada y válida mediante `startSyncSession()`.
4.  **Configuración de Hooks Globales**: Llama a `setupGlobalHooks()` para registrar los *hooks* de Super Productivity una única vez.

### Flujo de Sincronización por Sesión

Cada `SyncSession` gestiona su propio ciclo de sincronización, que incluye:

*   **`startFileWatcher`**: Se inicia un observador de archivos específico para `session.config.filePath`. Este observador ahora devuelve una función `stop` que se almacena en `session.stopWatcher`, permitiendo detener individualmente cada *watcher*.
*   **`handleFileChange(session)`**: Se invoca cuando el `file-watcher` detecta un cambio en el archivo Markdown. Utiliza un mecanismo de *debounce* (`mdToSpDebounceTimer`) para evitar sincronizaciones excesivas. Si la ventana de Super Productivity está enfocada, la sincronización MD -> SP se ejecuta inmediatamente; de lo contrario, se retrasa.
*   **`executeMdToSpSync(session)`**: Realiza la sincronización del archivo Markdown a Super Productivity (`mdToSp`). Durante esta operación, el `file-watcher` de la sesión se detiene temporalmente para evitar oscilaciones de sincronización (cambios en el archivo Markdown causados por la propia sincronización SP -> MD).
*   **`handleSpChange(session)`**: Se invoca cuando un *hook* de Super Productivity detecta un cambio relevante. También utiliza un *debounce* (`spToMdDebounceTimer`) y un mecanismo de *cooldown* (`lastMdToSpSyncTimestamp`) para evitar bucles de sincronización con los cambios del archivo Markdown.

## 4. Observador de Archivos Multi-Instancia (`file-watcher.ts`)

El módulo `src/background/sync/file-watcher.ts` ha sido refactorizado para soportar múltiples instancias. La función `startFileWatcher` ahora tiene la siguiente firma:

```typescript
export const startFileWatcher = (filePath: string, onChange: () => void): (() => void) => { ... };
```

Esta función devuelve una función de limpieza (`() => void`) que debe ser invocada para detener el observador de archivos específico que se inició. Esto contrasta con la versión anterior que utilizaba funciones globales `startFileWatcher` y `stopFileWatcher`, lo que impedía la gestión independiente de múltiples archivos.

El `file-watcher` sigue utilizando `PluginAPI.executeNodeScript` para acceder a las estadísticas del archivo (`fs.statSync`) y detectar cambios en la marca de tiempo de modificación (`mtime`).

> **SP ≥ 18.10.0 — `nodeExecution` bloqueado para plugins externos**: desde SP 18.10.0, `nodeExecution` está restringido a plugins integrados empaquetados. Fuente: commit `7f029b1` / PR #8205 de SP (*"fix(plugins): harden nodeExecution grants"*), que resuelve el advisory de seguridad **GHSA-78rv-m663-4fph**. Sustituye la confianza por-llamada del manifest por un grant en dos fases basado en token (`requestGrant` → `executeScript` → `revokeGrant`) emitido por el proceso principal de Electron **solo a plugins integrados empaquetados cuyo manifest puede verificar**. Error de SP para el resto: *"Node.js execution is currently only available to built-in desktop plugins."* Esto bloquea `executeNodeScript`, del que depende el file-watcher. Comprobado y confirmado en SP 18.10, 18.11 y 18.12 (Linux AppImage). **No necesariamente permanente** — el mensaje del commit dice que los plugins subidos se rechazan *"until uploaded plugin installation is moved to a main-process-owned verification path"*, así que SP prevé una futura vía verificada para plugins externos.
>
> **Actualización (SP ≥ 18.13.1):** el acceso a ficheros para plugins cargados externamente se rehabilitó desde **SP 18.13.1** tras un diálogo de consentimiento único. La restricción de "permanecer en SP 18.9.1" de arriba aplicaba solo a la ventana **SP 18.10.0–18.12.x**. El plugin está verificado funcionando en **SP 18.13.1–19.0.1** — ver §10. Evita únicamente el rango SP 18.10.0–18.12.x.

## 5. Comunicación UI-Background

Super Productivity inyecta `PluginAPI` directamente en el scope global del `iframe` que renderiza `index.html`. Desde v0.4.0 la configuración vive en el `localStorage` local del dispositivo del **contexto de background** (§2), que el iframe en sandbox no puede leer ni escribir directamente. Por tanto, todas las lecturas/escrituras de configuración pasan por un **bridge de mensajes**: el iframe envía un mensaje al background y el background — único propietario/escritor de la configuración — responde. Esto refleja cómo el `sync.md` integrado estructura su separación background/iframe, y reemplaza el modelo previo a 0.4.0 en el que el iframe llamaba a `PluginAPI.persistDataSynced` directamente (el peligro entre dispositivos descrito en §2).

El mecanismo del bridge: el helper `sendMessage(message)` del iframe publica `{ type: 'PLUGIN_MESSAGE', message, messageId }` a `window.parent` y escucha la respuesta, que llega como `{ type: 'PLUGIN_MESSAGE_RESPONSE', messageId, result }` — la carga útil está en **`result`**. El background registra `PluginAPI.onMessage(async (message) => …)` (detectado por característica: no está declarado en los tipos de la API `^1.0.1` pero se enlaza en tiempo de ejecución para plugins subidos, confirmado empíricamente) y devuelve un objeto de respuesta por tipo de mensaje. Ya **no** hay hook `persistedDataChanged` ni poll de configuración de 5 segundos — el iframe y el background comparten un mismo proceso, así que un cambio hecho en el panel llega al background de forma síncrona a través del bridge.

El patrón de comunicación es el siguiente:

*   **Lectura de configuración (`getConfig`)**: al cargarse, el iframe envía `{ type: 'getConfig' }`; el background responde `{ success: true, config }` con la configuración actual en memoria (`{ version, bindings, _lastSynced, _cachedProjects, … }`).
*   **Escritura de configuración (`saveConfig`)**: cuando el usuario guarda o elimina una vinculación, el iframe envía `{ type: 'saveConfig', config: { version, bindings } }` (solo los campos que gestiona la UI). El `applyConfigFromUi()` del background toma `version` + `bindings` del mensaje, preserva todos los campos que le pertenecen (`_lastSynced`, `_cachedProjects`, el estado del notificador de actualizaciones), escribe `localStorage` vía `persistConfig()` y — si el JSON de bindings realmente cambió respecto a `activeBindingsJson` — llama a `initSyncRegistry` para reiniciar las sesiones. Sin delay de 200 ms, sin fallback de polling: la escritura es local y síncrona.
*   **Lista de proyectos — llamada directa primero**: `loadProjects()` en el iframe llama a `PluginAPI.getAllProjects()` directamente al abrir el panel (igual que el plugin original `sync.md`). Si el resultado contiene más de un proyecto, se usa de inmediato. Si solo devuelve una entrada (Inbox — cuando el contexto del iframe aún no se ha inicializado completamente), la función cae al `_cachedProjects` y reintenta automáticamente hasta 3 veces con 2 segundos de separación.
*   **Caché de la lista de proyectos (`_cachedProjects`) + `getProjects`**: `background.ts` mantiene una copia de fallback de la lista de proyectos en la configuración bajo `_cachedProjects`, poblada al inicio y refrescada con cada hook `projectListUpdate`. El iframe registra un hook `projectListUpdate` y, cuando se dispara, solicita la lista fresca vía `{ type: 'getProjects' }` (el background refresca el caché y responde con él), de modo que un proyecto recién creado aparece sin reabrir el panel. Si el iframe nunca recibe ese hook, el botón ↺ y reabrir el panel siguen refrescando el desplegable.
*   **Filtrado del desplegable**: El desplegable solo muestra proyectos que no tienen ya una vinculación activa, evitando la doble vinculación accidental. En modo edición (cuando `bindingId` está establecido), el proyecto de la propia vinculación se reincluye para que siga siendo seleccionable.
*   **Puntos de entrada**: Una entrada de menú (`PluginAPI.registerMenuEntry`) abre el panel de configuración mediante `PluginAPI.showIndexHtmlAsView()`. Un botón de cabecera (`PluginAPI.registerHeaderButton`) dispara `syncAllNow()` para una sync bidireccional inmediata de todas las sesiones activas. La dirección se elige por sesión mediante una **huella de contenido**, no el mtime del archivo: `markSynced` registra un hash del contenido del fichero (`session.lastSyncedContentHash`, un hash cyrb53 vía `hashContent`), y si el fichero actual hashea distinto — es decir, se editó desde el último sync — MD→SP se ejecuta **primero** para que una edición reciente se importe antes de que el write-back pueda sobrescribirla; en caso contrario SP→MD va primero para capturar cambios de SP que no dispararon un hook. En ambos casos se ejecutan las dos direcciones. Hashear el contenido en lugar de comparar marcas de tiempo cierra el caso en que una edición preservaba un mtime igual o anterior y aun así era destruida por un write SP→MD-primero incondicional.

### Notificador de auto-actualización (`update-check.ts`)

Solo un *notificador* — nunca un auto-actualizador, ya que SP no expone ninguna API para reinstalarse a sí mismo, así que instalar una actualización sigue siendo una instalación manual del ZIP. En **cada** arranque de la app (y luego en un intervalo de 24 horas mientras la app siga abierta, limpiado en `onUnload` como todos los demás timers) `maybeCheckForUpdate()` consulta la última release desde la API **pública de Codeberg** (`.../releases/latest`). El chequeo deliberadamente **no** está limitado por ningún timestamp persistido: cada lanzamiento re-comprueba desde cero, de modo que un plugin actualizado entre lanzamientos reporta la versión más nueva correcta de inmediato en lugar de quedar suprimido por una ventana obsoleta de 24 horas. La URL está fijada a Codeberg a propósito: es el host desde el que instalan los usuarios finales, y así cualquier build consulta el mismo sitio. La petición se hace mediante `executeNodeScript` (un `https.get` de Node, enviando un `User-Agent` porque Codeberg está tras Cloudflare), no un `fetch()` del iframe — la CSP del sandbox bloquearía este último, y es el mismo mecanismo que usa el observador de archivos. `parseVersion` / `isNewerVersion` comparan la etiqueta de la release contra `__PLUGIN_VERSION__` (inyectada en tiempo de build) componente a componente.

Cuando existe una release estrictamente más nueva se muestra de tres formas, en prominencia decreciente: un **snack** coloreado mostrado una vez por lanzamiento de la app (solo desde el chequeo de arranque — el intervalo re-chequea en silencio, así que nunca da la lata a mitad de sesión); un **botón** de cabecera (icono `upgrade`) que abre la página de la release; y un **marcador en el pie del panel de configuración** (renderizado por el iframe desde los `_latestVersion`/`_latestUrl` persistidos, con estilo azul vía CSS). Detalles de robustez: un chequeo *fallido* (sin consentimiento de `nodeExecution` todavía, sin conexión, timeout, error de parseo) resuelve a `null` y simplemente se ignora — como cada arranque re-comprueba desde cero (sin throttle persistido), el siguiente lanzamiento reintenta automáticamente. Esto es lo que permite que el notificador sobreviva a la carrera habitual del primer arranque, en la que el chequeo se dispara antes de que el usuario acepte el diálogo de consentimiento de `nodeExecution`. `_lastUpdateCheck` se registra en un chequeo correcto solo a título informativo; ya no controla si un chequeo se ejecuta. Un chequeo correcto que no encuentra una versión más nueva limpia cualquier `_latestVersion`/`_latestUrl` obsoleto, para que el marcador desaparezca una vez que el usuario ha actualizado. Toda la funcionalidad es fire-and-forget y nunca bloquea ni afecta a la sincronización.

## 6. Manejo de Hooks Globales

La función `setupGlobalHooks()` en `sync-manager.ts` registra cuatro hooks de Super Productivity. Los nombres de hook se almacenan como constantes locales `SP_HOOKS` o strings inline en lugar de referenciar el enum `PluginHooks` en tiempo de ejecución, evitando una llamada `require('@super-productivity/plugin-api')` que fallaría dentro del IIFE del plugin. El tipo `PluginHooks` sigue importándose como `import type` exclusivamente para la verificación de tipos TypeScript.

*   **`taskUpdate` (hook principal)**: Se dispara para todas las mutaciones de tarea — tanto ediciones normales de propiedades (título, notas, estado de completado) como movimientos entre proyectos. El payload incluye un objeto `changes` que lista los campos modificados. Si `changes.projectId` está presente, la tarea fue movida: se notifican todas las sesiones para que tanto el fichero origen (tarea eliminada) como el fichero destino (tarea añadida) se actualicen correctamente. Para ediciones normales, solo se notifica la sesión cuyo `config.projectId` coincide con `task.projectId`, evitando writes innecesarios en proyectos no afectados.

*   **`anyTaskUpdate` (fallback legacy)**: Se mantiene para versiones de SP que disparan este hook en lugar de `taskUpdate`. Su payload no incluye objeto `changes`, por lo que la detección de movimientos no es posible aquí. Las sesiones se filtran por `task.projectId`. El timer de debounce en `handleSpChange` absorbe cualquier doble disparo si ambos hooks se despachan para el mismo evento.

*   **`projectListUpdate`**: Registrado para renombrados, reordenaciones, creaciones y eliminaciones de proyectos; cuando se dispara, se notifican todas las sesiones activas para que su estado SP→Markdown permanezca consistente. En la práctica **nunca se ha observado que se dispare ante la eliminación de un proyecto en SP 18.16 (macOS)** — ese evento llega al background únicamente a través del hook genérico `action` (ver más abajo). Se mantiene como respaldo para versiones de SP que sí lo despachen, pero la detección de proyecto eliminado ya no depende de él.

*   **`action` (red de seguridad de acción NgRx genérica)**: Se dispara con **cada** acción despachada, así que se filtra por `isStructuralTaskAction(type)` hasta las mutaciones estructurales de tareas (añadir / borrar / mover / convertir / restaurar de tareas y subtareas). Existe porque algunos cambios estructurales nunca llegan a `taskUpdate` / `anyTaskUpdate` — sobre todo `[Task] Add SubTask` (verificado en SP 18.16), por lo que añadir una subtarea no sincronizaba automáticamente. Las ediciones puras (ya cubiertas por `taskUpdate`) y las acciones de UI/selección se excluyen deliberadamente para evitar doble sync. Una acción en crudo no lleva `projectId`, así que se notifica a todas las sesiones; el cooldown y el debounce por sesión de `handleSpChange` regulan la propagación y suprimen el eco de las propias escrituras MD→SP del plugin.

    Este hook lleva además la **única** notificación que recibe el plugin cuando se elimina un proyecto: `[Task Shared] deleteProject`. Se reconoce con `isProjectDeleteAction(type)` (el mismo normalizador `normalizeActionType`, contra su propio conjunto conocido de una entrada) **antes** del filtro de acciones estructurales, y se enruta directamente a la comprobación de existencia del proyecto en lugar de a `handleSpChange` — cuyo `SP_HOOK_COOLDOWN_MS` se lo tragaría, porque eliminar un proyecto elimina también sus tareas y esos hooks acaban de sellar una sincronización. Ver §9.

*   **Registro único**: Un flag de módulo `hooksRegistered` garantiza que `setupGlobalHooks()` se ejecute como máximo una vez durante la vida del plugin, independientemente de cuántas veces se llame a `initSyncRegistry`.

## 7. Parser de Markdown (`markdown-parser.ts`)

### Comportamiento visible para el usuario: conversión padre–hijo de tareas

La estructura padre/hijo basada en indentación que se describe a continuación permite convertir tareas en tiempo real **en ambos sentidos** — editando directamente el archivo Markdown (MD→SP), o cambiando el padre de una tarea en la propia SP (SP→MD, vía el menú contextual o arrastrando):

- **Ascender una subtarea a padre**: desindentarla a profundidad 0 → en el próximo ciclo de sync se convierte en tarea padre independiente en SP.
- **Descender una tarea padre a subtarea**: indentarla bajo otra tarea → en el próximo ciclo de sync se convierte en subtarea de esa tarea padre.
- **Mover una subtarea a otro padre**: cambiar su nivel de indentación para colocarla bajo el nuevo padre.
- **Ascender/descender/mover una tarea en la propia SP** *(Bug #47, publicado en v0.4.2)*: cambiar el `parentId` de una tarea en SP — vía "convertir en tarea principal", "convertir en subtarea", o arrastrando entre la lista raíz y un grupo de subtareas — se escribe de vuelta al `.md` en la siguiente sync SP→MD, reubicando la línea de la tarea a su nuevo nivel de anidamiento. Ver §8 para cómo el merge en sitio detecta y reubica estos cambios.

**Restricciones**: Las tareas con `repeatCfgId` (tareas recurrentes) o `issueId` (tareas vinculadas a issues) no pueden convertirse en subtareas; SP rechazará la operación y las dejará como tareas padre. Sí pueden ascenderse de subtarea a padre sin restricciones.

`parseMarkdownWithErrors` convierte texto Markdown en un array de objetos `ParsedTask`. Comportamientos clave:

*   **Detección de tareas**: Las líneas que coinciden con `/^(\s*)- \[([ x])\]\s*(?:<!--([^>]+)-->\s*)?(.*)$/` se parsean como tareas. El nivel de indentación determina padre (depth 0) vs subtarea (depth 1). Las tareas a depth ≥ 2 se convierten en notas del ancestro más cercano.
*   **Auto-detección de indentación**: `detectIndentSize` infiere la unidad de indentación (2 o 4 espacios) a partir del patrón de tarea indentada más frecuente en el archivo.
*   **Cabecera del documento**: Todo el contenido antes de la primera línea de tarea se captura como `header` y se preserva verbatim en el write-back SP→Markdown.
*   **Notas**: Las líneas no-tarea y no-encabezado que siguen **inmediatamente** a una tarea — hasta la primera línea en blanco — se añaden al campo `notes` de esa tarea. Una línea en blanco termina la nota.
*   **Líneas en blanco**: Una línea con `line.trim() === ''` **termina la nota de la tarea actual**: resetea `currentTaskIndex`, de modo que cualquier texto tras el blanco se trata como contenido suelto del documento, no como continuación de las notas de la tarea anterior. A diferencia de un título de sección, una línea en blanco deja `parentStack` intacto, así que un blanco entre subtareas hermanas no huérfana a la subtarea que le sigue. Esto refleja el write-back SP→Markdown, donde al borrar una tarea también se deja de eliminar líneas de nota en la primera línea en blanco — de forma que un bloque separado de una tarea por un blanco ni se absorbe como su nota al importar ni se elimina con ella al borrar. (Compromiso: una nota multi-párrafo con una línea en blanco interna solo aporta su primer bloque a la nota de SP; el resto queda en el archivo como contenido suelto.)
*   **Títulos de sección**: Las líneas que coinciden con `/^#{1,6}\s/` (encabezados Markdown) se tratan como delimitadores de sección. Resetean `currentTaskIndex` y `parentStack` para que las líneas siguientes no se acumulen en la tarea anterior, y no se añaden a las notas de ninguna tarea. Las tareas tras un título de sección se parsean normalmente como nuevas tareas de nivel raíz.

### Eliminación de etiquetas de estado (`stripStatusTags`)

El parser elimina una etiqueta de estado **al final** de cada título de tarea mediante `stripStatusTags()` antes de almacenarlo como título de la tarea de SP, para que el título quede limpio. Elimina `@todo`, `@doing` o `@done` — cada una con un `(fecha[ hora])` opcional — pero **solo cuando la etiqueta está al FINAL de la línea**; un `@palabra` en medio de un título se deja intacto. El borrado se aplica de forma repetida por si existen varias etiquetas al final. En la lectura, el parser acepta `@done`, `@done(YYYY-MM-DD)` y `@done(YYYY-MM-DD HH:mm)` — las tres significan *completada*, aunque el estado de la casilla (`[x]`) sigue siendo la fuente de verdad para el completado; la etiqueta en sí solo aporta la fecha/hora de finalización.

## 8. Fusión SP→Markdown en sitio (`sp-to-md.ts`)

`spToMd` ahora utiliza una estrategia de **fusión en sitio** cuando el archivo Markdown ya existe. En lugar de regenerar el archivo completo a partir de los datos de SP, preserva todo el contenido no-tarea y actualiza únicamente las líneas de casilla de verificación.

### Renderizado de la línea de tarea y la etiqueta `@done`

Un único helper, `buildTaskLine()`, renderiza **todas** las líneas de tarea — `<indent>- [ /x] <!--id--> title[ @done(...)]` — y lo usan `formatTask` (el camino de regeneración completa) y todos los puntos de reconstrucción de la fusión en sitio, de modo que el formato emitido es consistente en todas partes.

El sufijo `@done` lo gestionan dos helpers que cooperan:

*   **`formatDoneTag(task)`** deriva la etiqueta del estado de SP: `@done(YYYY-MM-DD HH:mm)` en hora local de 24h cuando la tarea está completada y tiene `doneOn`; un `@done` escueto (sin fecha) cuando está completada pero `doneOn` es null; y la cadena vacía cuando la tarea no está completada.
*   **`extractDoneTag(rawTitle)`** extrae un `@done[(fecha[ hora])]` final ya existente de la línea que se va a reemplazar. Esto existe porque **SP no almacena una fecha de finalización leída del archivo** — tras una importación, `task.doneOn` es null. Por ello `buildTaskLine` **preserva** el `@done(fecha)` ya presente en la línea siempre que la tarea siga completada, de modo que una fecha importada o escrita a mano sobrevive a los ciclos de ida y vuelta en lugar de colapsar a un `@done` escueto. Una tarea **recién completada en SP** (sin etiqueta previa en la línea) no tiene fecha que preservar, así que obtiene su `@done` de `doneOn`.

El **camino de coincidencia por título sin ID** (emparejar una línea de archivo sin etiqueta con una tarea de SP por título, para estampar su `<!--id-->` en sitio) elimina las etiquetas de estado antes de comparar, de modo que una línea como `- [x] Buy milk @done(2026-07-07 14:30)` coincide con su título limpio de SP (`Buy milk`) y se estampa en sitio en lugar de generar una tarea duplicada.

**Decisión de diseño — solo se escribe `@done`.** El plugin nunca escribe `@todo` / `@doing`: SP expone solo un booleano completado/no-completado sin un estado limpio de "en progreso", y esas etiquetas pertenecen al modelo de estado más rico de la app complementaria Taskdown. Se toleran en la lectura (`stripStatusTags`, §7) pero nunca se emiten.

### `mergeSpIntoExistingFile`

```typescript
export const mergeSpIntoExistingFile = (
  existingContent: string,
  spTaskMap: Map<string, Task>,
  orderedTasks: Task[],
): string
```

La función procesa el archivo línea a línea:

*   **Línea de tarea con `<!--id-->` conocido cuyo `parentId` en SP sigue coincidiendo con la ubicación del fichero**: la línea se actualiza en sitio — el estado de la casilla y el título se refrescan desde SP; la indentación original se preserva.
*   **Línea de tarea con `<!--id-->` conocido cuyo `parentId` en SP ya NO coincide con la ubicación del fichero** *(Bug #47 — la tarea fue ascendida, descendida o movida a otro padre en SP, vía el menú contextual o arrastrando)*: la línea **no** se emite aquí — un `taskStack` deriva el padre de cada línea tal como la coloca el fichero (la tarea precedente más cercana con una indentación estrictamente menor), y una discrepancia contra `spTask.parentId` desvía la tarea a la distribución de tareas nuevas posterior al bucle, que la reubica bajo su nuevo padre (o en la raíz) con la indentación correcta, preservando su fecha `@done` y regenerando sus notas en la nueva ubicación. **Limitación conocida:** una tarea ascendida a nivel raíz se añade al final del archivo en lugar de mantenerse en su posición de SP (Mejora C3, sin programar).
*   **Línea de tarea con `<!--id-->` desconocido** (tarea eliminada en SP): la línea se elimina, así como las líneas de nota inmediatamente posteriores (líneas no-tarea, no-vacías, no-encabezado-de-sección).
*   **Línea de tarea sin `<!--id-->`**: se mantiene exactamente como está; el ID se estampará en el próximo ciclo Markdown→SP.
*   **Resto de líneas** (títulos de sección, líneas en blanco, notas, Markdown libre): se mantienen exactamente como están, de forma incondicional.

Tras procesar todas las líneas, las tareas de SP cuyos IDs no se encontraron en el archivo (tareas nuevas añadidas en SP) se añaden al final mediante `convertTasksToMarkdown`.

Si el archivo no existe (`readTasksFile` devuelve `null`), `spToMd` genera el contenido completo con `convertTasksToMarkdown`.

### Implicaciones

*   Los títulos de sección y las líneas en blanco dentro del área de tareas sobreviven a cada write-back SP→Markdown.
*   Las notas escritas en el archivo Markdown se preservan tal cual; las notas modificadas en SP **no** se escriben de vuelta al archivo (el archivo es la fuente de verdad para el contenido de las notas).
*   Las tareas eliminadas en SP se eliminan limpiamente junto con sus líneas de nota asociadas.

## 9. Manejo de Recursos Ausentes y Descarga del Plugin

Una vinculación nunca debe seguir ejecutándose en un estado roto. Cuando una sincronización descubre que un recurso del que depende ha desaparecido — ya sea el archivo Markdown o el proyecto de Super Productivity — el plugin detiene el fallo silencioso y obliga al usuario a resolverlo mediante un diálogo modal. Esta lógica reside en un módulo dedicado, `src/background/sync/missing-resource.ts`, integrado en `sync-manager.ts` y `background.ts`.

### `missing-resource.ts`

El módulo expone tres primitivas:

*   **`showMissingFileDialog`** y **`showMissingProjectDialog`**: presentan un modal mediante `PluginAPI.openDialog`. La API de SP no dispone de un snack con botones — `showSnack` es pasivo (solo `msg` / `type` / `ico`, sin acciones) — así que una decisión accionable requiere un diálogo real.
*   **`createSpProject`**: un envoltorio con detección de característica sobre `PluginAPI.addProject`. Comprueba la existencia del método antes de llamarlo, de modo que el plugin degrada de forma elegante en versiones de la API que no exponen la creación de proyectos.

### Política y diálogos

*   **Archivo `.md` ausente (caso 3a)**: el diálogo ofrece **Recrear desde SP** / **Eliminar vinculación** / **Ignorar**. Una vinculación recién creada que nunca ha sincronizado se trata de forma distinta: su archivo se crea silenciosamente, porque no hay nada que perder. Ambos casos se discriminan según si la vinculación ha sincronizado alguna vez antes, lo cual se registra mediante un mapa persistido `_lastSynced` indexado por id de vinculación. Un archivo que existió y luego desapareció siempre pregunta; una vinculación en su primera ejecución nunca lo hace.
*   **Proyecto de SP eliminado (caso 3b)**: el archivo `.md` está intacto y nunca se toca en este camino. El diálogo ofrece **Recrear proyecto en SP** / **Eliminar vinculación** / **Eliminar + limpiar archivo** / **Ignorar**. *Eliminar + limpiar archivo* elimina la vinculación **y** retira del `.md` los marcadores ocultos `<!--taskId-->`, dejando el archivo neutro, igual que el borrado de vinculación del panel de configuración; ambos usan un único helper compartido `cleanFileMarkers`, y el botón solo se ofrece mientras el archivo sigue existiendo (`canRecreate`). Elegir *Recrear* ejecuta `createSpProject(title)` bajo el último `projectTitle` conocido de la vinculación, luego `repointBinding` actualiza el `projectId` de la vinculación al del proyecto recién creado, y finalmente las tareas se reimportan desde el `.md`. Los marcadores `<!--taskId-->` obsoletos se eliminan primero mediante `stripTaskIds`, de modo que las tareas se crean de nuevo en lugar de fallar contra ids inexistentes. Si el `.md` también ha desaparecido, solo se ofrecen **Eliminar vinculación** / **Ignorar**.

### Detección

*   **`divertIfProjectMissing`** comprueba `getAllProjects()` y se ejecuta en **los cuatro caminos de sincronización ANTES de la comprobación del archivo**. El orden es crítico: un proyecto eliminado dejaría, de lo contrario, que `spToMd` escribiera un archivo vacío y borrara el `.md`.
*   **`divertIfFileMissing`** maneja el caso de archivo ausente.
*   Ambos **fallan en abierto** (fail open): si la lista de proyectos no puede leerse, la sincronización procede con normalidad en lugar de bloquearse ante una condición no verificable.
*   **Detección proactiva de un proyecto eliminado**: los cuatro caminos de sincronización anteriores solo advierten un proyecto eliminado cuando algo *distinto* dispara una sincronización, así que el plugin reacciona además a la propia eliminación. El `[Task Shared] deleteProject` del hook `action` (§6) ejecuta de inmediato la comprobación de existencia para todas las sesiones; `PROJECT_MISSING_RECHECK_MS` vuelve a comprobar una vez si el almacén de proyectos de SP aún no ha soltado el proyecto, lo que también evita confundir un simple renombrado con una eliminación.
*   **`handleMissingProject(session, proactive)` es el único punto de paso** por el que discurren todos los caminos de detección, de modo que la experiencia proactiva vive en un solo sitio. Cuando se alcanza de forma proactiva: (1) lanza un `showSnack` de aviso inmediato — un snack se pinta desde el contexto de background y sobrevive a la navegación de SP — y (2) espera `PROJECT_DELETE_SETTLE_MS` (2 s) antes de abrir el modal, porque eliminar el proyecto *activo* hace que SP se aleje de esa vista y descarte cualquier modal abierto dentro de esa ventana de agitación (ver §10). Medido en vivo en SP 18.16 (macOS): snack ≈ 7 ms tras la eliminación, diálogo ≈ 2,0 s tras ella, y el diálogo permanece abierto hasta que el usuario elige. El texto del snack es deliberadamente escueto — `project "<título>" was deleted — opening options…` — porque solo tiene que cubrir los ~2 s en los que aún no puede mostrarse el modal; el modal posterior lleva las opciones. Nombra el **proyecto** (`projectTitle`, que la comprobación de existencia refresca en cada pasada, con el basename del fichero como respaldo para una vinculación cuyo proyecto nunca se vio), no la ruta del fichero: una ruta absoluta hacía el mensaje ilegible, y no debe pedir al usuario que pulse *Sync Now*, que el diálogo proactivo ha vuelto innecesario. Su tipo es `INFO`, no `ERROR`: la eliminación es algo que el usuario acaba de hacer a propósito, y la decisión en sí corresponde al modal posterior.

### Robustez

*   **Configuración con un único escritor**: todas las escrituras de configuración pasan por `persistConfig()` en `background.ts`, que escribe el `currentConfig` en memoria a `localStorage` (local del dispositivo; ver §5). `currentConfig` es la única fuente de verdad — el background es el único escritor, y el iframe nunca persiste directamente (envía `saveConfig` por el bridge). `applyConfigFromUi()` toma solo la `version` + los `bindings` que gestiona la UI, preserva todos los campos que posee el background (`_lastSynced`, `_cachedProjects`, el estado del notificador de actualizaciones) y reinicia el registry **solo** cuando el JSON de bindings realmente cambió respecto a `activeBindingsJson` — de modo que las actualizaciones puramente internas (una marca de tiempo `_lastSynced`, un refresco de `projectTitle`) nunca lo reinician. Esto reemplaza el `checkForConfigChanges` + poll de almacenamiento de 5 segundos previo a v0.4.0, que tenía que protegerse de adoptar una lectura sincronizada stale capaz de revertir un repunte de vinculación en curso.
*   **Guardas de diálogo**: las guardas son de ámbito de módulo e indexadas por id de vinculación, así que sobreviven a los reinicios del registry. Se muestra como máximo un diálogo por vinculación, más un enfriamiento (cooldown) posterior al cierre. Un cerrojo `recreatingBindings` se toma al principio del handler de recreación para romper el bucle de realimentación `addProject → projectListUpdate → nueva comprobación`. `waitForProjectVisible` sondea `getAllProjects()` hasta que el proyecto recreado aparece antes de que se ejecute la importación.
*   **Peculiaridad de `openDialog`**: la promesa de `openDialog` de SP se resuelve cuando el diálogo se **muestra**, no cuando se pulsa un botón — los handlers `onClick` de los botones se disparan de forma independiente. Por tanto, la lógica de guarda nunca debe apoyarse en esa promesa para acotar nada.

### Descarga del plugin — `plugin.onUnload()`

Registrar un handler `onUnload` es **obligatorio**. Al recargar o reinstalar, SP desregistra los hooks del plugin pero **no** detiene sus timers `setInterval` — los observadores de archivos y el intervalo diario de comprobación de actualizaciones. Sin descarga, cada reinstalación dejaba una instancia **zombi** que seguía ejecutando sus timers y aún podía crear proyectos, compitiendo con la instancia nueva por la configuración compartida; esta fue la causa del comportamiento de proyectos duplicados descontrolados observado en las pruebas. El handler `onUnload` llama a `shutdownSyncRegistry` (que descarta cada sesión y su observador de archivos), limpia el intervalo diario de comprobación de actualizaciones y limpia el timer de debounce de persistencia. (Desde v0.4.0 ya no hay un intervalo de poll de configuración que limpiar — la configuración es `localStorage` local del dispositivo accedida a través del bridge de mensajes, así que no hay nada que sondear; ver §5.)

El manifest incorporó el permiso **`addProject`** para habilitar la recreación de proyectos.

### Limpieza opcional del `.md` al eliminar una vinculación

Eliminar una vinculación desde el panel de configuración ofrece una **limpieza de archivo opcional** que elimina los marcadores de sincronización ocultos `<!--…-->`, dejando el Markdown neutro (desvinculado). La confirmación de borrado se muestra mediante el `PluginAPI.openDialog` nativo de SP desde el iframe de configuración (tres opciones: **Eliminar vinculación**, **Eliminar + limpiar archivo**, **Cancelar**), con un modal propio dentro del panel como fallback cuando `openDialog` no está expuesto en el contexto del iframe. La limpieza en sí es una reescritura de archivo sencilla realizada mediante `executeNodeScript` (`sanitizeMdFile` lee el archivo, elimina los marcadores `<!--id-->` con una regex que replica el `stripTaskIds` de `sync-manager`, y lo vuelve a escribir). Es estrictamente opcional — eliminar una vinculación nunca reescribe el archivo del usuario de forma silenciosa — e informa del resultado (limpiado / ya limpio / archivo no encontrado).

## 10. Problemas Conocidos y Compatibilidad de Plataforma

### Nombres de hook de SP y `nodeExecution`

El plugin carga y funciona por completo en **SP 18.9.1D** (macOS, Apple Silicon) — incluido `nodeExecution` (lectura/escritura/sync de ficheros funcionan) — y, a partir de la versión actual, está **verificado funcionando en SP 18.13.1–19.0.1** (macOS, Apple Silicon; v0.3.0/v0.3.1 verificados en vivo en 18.16.0D; 19.0.1 confirmado mediante uso diario, sin errores, sin funcionalidad ausente, a fecha de 2026-09-17). Dos asunciones previas resultaron ser inexactas para la versión 18.9.1D:

- El hook de datos persistidos se llama **`persistedDataChanged`**, no `persistedDataUpdate`. SP 18.9.1D rechaza `persistedDataUpdate` por validación typia, así que registrarlo falla en silencio (el hook nunca se dispara). Se asumía que el rename era exclusivo de SP 18.10.0; ya está en efecto en 18.9.1D. El plugin registró `persistedDataChanged` (background + iframe + `manifest.json`) hasta v0.3.x, cuando la configuración se persistía vía `persistDataSynced`. **Desde v0.4.0 el plugin ya no registra este hook en absoluto** — la configuración es `localStorage` local del dispositivo accedida a través del bridge de mensajes (§5), así que no hay ningún cambio de datos sincronizados que escuchar.
- `nodeExecution` funciona en 18.9.1D.

### `nodeExecution` a lo largo de las versiones de SP

- **SP 18.10.0–18.12.x** bloqueaban `nodeExecution` para plugins cargados externamente (confirmado en 18.10, 18.11, 18.12) — un endurecimiento de seguridad deliberado (commit `7f029b1` / PR #8205 de SP; ver nota en §4).
- **SP ≥ 18.13.1 reabre `nodeExecution` para plugins externos/subidos** tras un diálogo nativo de consentimiento en el proceso principal: el usuario pulsa **Permitir** una vez y el consentimiento persiste por plugin (PR #8576, publicado en v18.13.1; persistencia por plugin vía PR #8600; el PR #8708 corrigió el crash `spawn node ENOENT` en builds empaquetados de macOS). Esto está **verificado funcionando en macOS M2** — incluidos `PluginAPI.openDialog` y `PluginAPI.addProject`, de los que depende el manejo de recursos ausentes (ver §9).

### Comportamientos de plataforma a tener en cuenta

- **`openDialog` se resuelve al mostrarse, no al pulsar**: la promesa de `PluginAPI.openDialog` de SP se resuelve en cuanto el diálogo se muestra, no cuando el usuario pulsa un botón; los handlers `onClick` de los botones se disparan de forma independiente. Cualquier lógica de guarda o de control de flujo debe tenerlo en cuenta y nunca tratar la resolución de la promesa como una señal de "decisión tomada" (ver §9).
- **`onReady` y `onUnload` ahora se usan**: las llamadas a `executeNodeScript` y la sincronización inicial se supeditan a `plugin.onReady()` (con detección de característica y un fallback), y `plugin.onUnload()` realiza la descarga — deteniendo el timer de debounce de persistencia, el intervalo diario de comprobación de actualizaciones y todos los observadores de archivos mediante `shutdownSyncRegistry` (ver §9). Esto se alinea con el propio sync-md integrado de SP y evita instancias zombi al reinstalar.
- **Los botones de cabecera ignoran `color`**: `PluginAPI.registerHeaderButton` acepta un campo `color` (`'primary' | 'accent' | 'warn'`), pero SP renderiza los botones de cabecera en gris neutro en la barra independientemente de su valor (verificado que `primary`/`accent`/`warn` son idénticos en 18.16). El botón de auto-actualización se distingue por tanto solo por su icono `upgrade`; la señal coloreada/llamativa viene del snack de arranque y del marcador del pie del panel de configuración (con estilo CSS) en su lugar.
- **Los plugins subidos se instalan DESACTIVADOS**: instalar un ZIP de plugin — incluida la reinstalación sobre uno existente — deja el plugin **deshabilitado** (verificado en macOS, SP 18.16). SP sigue ejecutando la instancia previamente activa y no carga en caliente el código nuevo hasta que el usuario lo activa a mano. Al verificar un build nuevo: desinstalar → salir de SP → reabrir → instalar → **activar** → confirmar que el pie del panel de configuración muestra la versión nueva *antes* de probar; de lo contrario toda observación describe el build antiguo.
- **SP descarta un modal abierto durante la navegación posterior a un borrado**: eliminar el proyecto activo hace que SP se aleje de esa vista y la desmonte, y un `openDialog` abierto dentro de esa ventana de agitación se cierra sin interacción del usuario (`PluginBridge: Dialog closed` en la consola de SP). Por eso un diálogo abierto proactivamente debe diferirse más allá de la navegación (`PROJECT_DELETE_SETTLE_MS`), y el aviso inmediato debe ser un snack, que se pinta desde el contexto de background y no lo descarta la navegación (ver §9).

### Mac (Apple Silicon) — problemas conocidos

_Sin problemas abiertos específicos de Mac._ Los dos problemas conocidos previos están resueltos:

1. **Sync inicial al crear una nueva vinculación** *(resuelto v0.1.1)*: Crear/editar una vinculación desde el panel de configuración no disparaba la sync hasta reiniciar la app. Causa raíz: el plugin registraba el hook como `persistedDataUpdate`, que SP 18.9.1D rechaza (el nombre válido es `persistedDataChanged`), así que el hook nunca se disparaba y el poll de respaldo de 5 segundos no compensaba (estaba detrás de un `await refreshProjectsCache()` en el arranque). **Corrección**: renombrado el hook a `persistedDataChanged` y reordenado el IIFE del background para que el hook y el poll se cableen antes de ese await no crítico. Verificado en Mac: alta/baja de vinculación ahora sincronizan sin reiniciar.

2. **Botón "Sync Now" de cabecera no visible** *(resuelto v0.1.0)*: En Mac 18.9.1 `PluginAPI.registerHeaderButton` se registraba sin error pero no aparecía ningún botón en la barra de SP (funcionaba en Linux/AppImage). La causa raíz era una **carrera de tiempo en el registro**: el botón se registraba al final de la IIFE `async` del punto de entrada del background, después de que se resolvieran los `await` de `loadSyncedData`/`refreshProjectsCache`, momento en el que SP ya había construido su barra de cabecera en Mac. **Corrección**: `registerMenuEntry` y `registerHeaderButton` se llaman ahora de forma síncrona al principio de la IIFE, antes de cualquier `await`, de modo que el registro nunca se retrasa más allá de la construcción de la barra. Renderizado confirmado en Mac tras el cambio.

## 11. Conclusión Técnica

La refactorización a `sync.md Multi` ha resultado en una arquitectura modular y escalable. La introducción de `SyncSession`s y un `SyncRegistry` centralizado, junto con un `file-watcher` multi-instancia, permite una gestión eficiente y aislada de múltiples flujos de sincronización. La estrategia de fusión en sitio de `spToMd` garantiza que la estructura creada por el usuario (títulos de sección, notas, Markdown libre) nunca sea destruida por un write-back, haciendo que el plugin sea seguro para archivos que mezclan tareas de SP con contenido editorial enriquecido. La lógica de negocio central (`mdToSp`, `spToMd`, `generateTaskOperations`) se ha mantenido intacta y se reutiliza dentro de cada sesión, minimizando el riesgo y maximizando la eficiencia del desarrollo.

Las pruebas en producción endurecieron el ciclo de vida de las vinculaciones. Desde v0.4.0, los cambios de configuración desde la UI llegan al background de forma **síncrona a través del bridge de mensajes** (§5): el iframe envía `saveConfig`, `applyConfigFromUi()` es el único camino autorizado para reiniciar el registro de sincronización, y no hay polling ni indirección por hook de almacenamiento contra los que competir. El desplegable de proyectos se mantiene fresco mediante una llamada directa a `getAllProjects()` más un hook `projectListUpdate` en el iframe que vuelve a solicitar la lista por el bridge, de modo que los proyectos nuevos de SP aparecen sin necesidad de reiniciar la aplicación.
