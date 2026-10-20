# sync.md Multi — Revisión de Calidad y Corrección de Bugs

## Resumen

Este documento recoge la revisión de calidad, las correcciones de bugs y el endurecimiento aplicados a la implementación multi-proyecto de `sync.md` por Fernando Pindado con Claude (Anthropic).

## Bugs identificados y corregidos

Se detectaron y corrigieron 12 bugs, agrupados por área:

**Bug #1 — `src/index.ts`: exportaciones incorrectas**
El fichero copiaba literalmente el `index.ts` del plugin single, referenciando módulos inexistentes (`sync-utils`, rutas incorrectas). Corregido mapeando cada export a la ruta real del módulo multi.

**Bugs #2 y #3 — Tipo `LocalUserCfg` no existe en multi**
`sp-to-md.ts` y `verify-sync.ts` importaban `LocalUserCfg` de `local-config.ts`, tipo que no existe en la versión multi. El tipo correcto es `SyncBindingCfg`. El mismo error afectaba a seis ficheros de test (`test-utils.ts`, `header-preservation.integration.spec.ts`, `sp-to-md.test.ts`, `verify-sync.test.ts`). Todos corregidos.

**Bug #4 — Hook `PROJECT_LIST_UPDATE` no registrado**
`setupGlobalHooks()` solo registraba `ANY_TASK_UPDATE`. Los cambios en la lista de proyectos (renombrado, eliminación) no desencadenaban sync. Añadido el registro de `PROJECT_LIST_UPDATE` en `sync-manager.ts` y en `manifest.json`.

**Bug #5 — Routing de hooks sin filtrado por `projectId`**
El callback de `ANY_TASK_UPDATE` notificaba a todas las sesiones indiscriminadamente. Corregido con filtrado payload-aware: si el payload incluye `projectId`, solo se notifican las sesiones del proyecto afectado; si no, fallback a todas las sesiones.

**Bug #6 — Errores de sync sin notificación al usuario**
Los bloques `catch` de `performInitialSync` y `executeMdToSpSync` logueaban el error pero no mostraban ningún aviso al usuario. Añadidas llamadas a `PluginAPI.showSnack` con mensaje de error contextualizado.

**Bug #7 — `syncNow` llamaba a `initSyncRegistry` en lugar de `syncAllNow`**
El handler del mensaje `syncNow` en `ui-bridge.ts` invocaba `initSyncRegistry(config.bindings)`, lo que destruía y recreaba todas las sesiones (teardown + reinicio del watcher) cuando el usuario solo quería forzar una sync. Implementada la función `syncAllNow()` en `sync-manager.ts` y actualizado `ui-bridge.ts` para usarla.

**Bug #8 — Sin validación de rutas duplicadas en la UI**
El formulario de la UI permitía crear dos bindings apuntando al mismo fichero `.md`, lo que habría generado dos file watchers compitiendo sobre el mismo archivo y bucles de sync garantizados. Añadida validación en el submit del formulario.

**Bug #9 — `package.json` con nombre incorrecto**
`"name": "sync-md"` en lugar de `"name": "sync-md-multi"`. Corregido.

**Bug #10 — Constante `SYNC_DEBOUNCE_MS_UNFOCUSED` sin usar (dead code)**
Exportada en `config.const.ts` pero no importada en ningún módulo. Eliminada.

**Bug #11 — `ensureDirectoryExists` llamado en `sp-to-md.ts` de forma redundante**
`writeTasksFile` ya llama internamente a `mkdirSync` si el directorio no existe. La llamada explícita era redundante y generaba un import innecesario. Eliminada.

**Bug #12 — `validateOperations` en `generate-task-operations.ts` no filtraba operaciones inválidas**
La función calculaba los índices de operaciones inválidas pero devolvía el array completo sin filtrar. Las operaciones inválidas se ejecutaban de todas formas, potencialmente causando corrupción de estado. Corregido filtrando el array por los índices detectados antes del split reorder/otros.

## Correcciones en tests

Dos ficheros de test estaban completamente desactualizados para la arquitectura multi:

**`sync-manager-edge-cases.test.ts`** — Reescrito para usar `initSyncRegistry([mockConfig])` en lugar de `initSyncManager(mockConfig)`, mock de `startFileWatcher` devolviendo `jest.fn()` como disposer, y eliminados mocks de `stopFileWatcher` y `ensureDirectoryExists` (ya no existen en multi).

**`sync-oscillation-prevention.test.ts`** — Reescrito para usar `initSyncRegistry([mockConfig])`, introducido `mockDisposer = jest.fn()` para rastrear las llamadas de parada del watcher (sustituyendo el antiguo `fileWatcher.stopFileWatcher` global), y actualizadas todas las aserciones correspondientes.

## Resultados de verificación final (Ronda 1)

- **Tests**: 271/271 pasan en 36 suites (`npm test`).
- **TypeScript**: Sin errores en el código fuente del plugin (`npx tsc --noEmit`). Se eliminó la entrada `vite/client` de `compilerOptions.types` y se borró `vite.config.ts` — ambos eran artefactos Vite preexistentes sin rol alguno en el build de este plugin.
- **Corrección en runtime — "Dynamic require of @super-productivity/plugin-api is not supported"**: Al instalar el ZIP compilado en Super Productivity se observó un error crítico en tiempo de ejecución. Causa raíz: `import { PluginHooks }` (un import de valor) hacía que esbuild emitiera una llamada `require('@super-productivity/plugin-api')` dentro del bundle IIFE, donde `require` no está disponible. Solución: cambiar todos los imports de este paquete a `import type { ... }` (borrados en tiempo de compilación) e introducir constantes locales `SP_HOOKS` en `sync-manager.ts` para almacenar los nombres de los hooks en tiempo de ejecución. El resto de ficheros también se actualizaron a `import type`. La opción `moduleResolution` de `tsconfig.json` se actualizó del valor obsoleto `"node"` a `"bundler"`.
- **Documentación**: Ambos READMEs (EN y ES) reescritos con descripción del formato Markdown, flujo de sync, prevención de oscilación, comportamiento de foco de ventana, validación de rutas duplicadas y sección para desarrolladores.

---

## Ronda 2 — Bugs en pruebas reales (Mayo 2026)

Tras la primera ronda de correcciones, el plugin se instaló y probó en un entorno real de Super Productivity (Linux Mint 22.3, AppImage, Firefox). Se encontraron y corrigieron ocho bugs adicionales.

**Bug #13 — El desplegable de proyectos mostraba solo "Inbox"**
`getAllProjects()` llamado desde dentro de un iframe con sandbox solo devuelve el proyecto Inbox. La lista completa de proyectos solo es accesible desde el contexto del background script. Solución: `background.ts` llama a `getAllProjects()` al inicio y cada vez que se dispara `projectListUpdate`, almacenando el resultado en `persistDataSynced` bajo la clave `_cachedProjects`. El iframe lee esta caché mediante `loadSyncedData()` y popula el desplegable desde `_cachedProjects`.

**Bug #14 — No había entrada de menú para abrir la UI de configuración del plugin**
La UI del plugin no tenía ningún punto de acceso tras la instalación. Solución: registrar una entrada de menú (`PluginAPI.registerMenuEntry`) que llama a `PluginAPI.showIndexHtmlAsView()`, y un botón de cabecera (`PluginAPI.registerHeaderButton`) etiquetado "Sync Now" que desencadena una sync SP→Markdown inmediata para todas las sesiones.

**Bug #15 — Nombres de hooks SP incorrectos (mayúsculas vs camelCase)**
`SP_HOOKS.ANY_TASK_UPDATE` tenía el valor `'ANY_TASK_UPDATE'` y `SP_HOOKS.PROJECT_LIST_UPDATE` el valor `'PROJECT_LIST_UPDATE'`. SP despacha los hooks en camelCase (`'anyTaskUpdate'`, `'projectListUpdate'`) tal como se declaran en `manifest.json`. Las cadenas en mayúsculas nunca coincidían, por lo que la sync SP→Markdown nunca se activaba tras cambios en las tareas. Solución: corregir los valores de las constantes `SP_HOOKS`.

**Bug #16 — `setupGlobalHooks` se llamaba múltiples veces, registrando handlers duplicados**
`setupGlobalHooks()` se invocaba en cada llamada a `initSyncRegistry` (es decir, cada vez que cambiaba la configuración de vinculaciones). Cada llamada añadía otra copia de cada handler; tras N guardados de configuración había N copias disparándose en cada actualización de tarea. Solución: añadir un flag de módulo `hooksRegistered` que garantiza que `setupGlobalHooks()` se llame como máximo una vez por vida del plugin. Un export complementario `_resetForTesting()` permite a los tests resetear este flag entre casos de prueba.

**Bug #17 — La sync inicial no escribía los IDs de tarea de vuelta al archivo Markdown**
En `performInitialSync`, tras llamar a `mdToSp` (que crea las tareas en SP), se usaba un check de `verifySyncState` para decidir si llamar a `spToMd`. Como el estado de SP puede no estar completamente asentado justo después de `batchUpdateForProject`, la verificación podía reportar "en sync" antes de que las tareas fueran visibles, por lo que `spToMd` nunca se llamaba y los IDs nunca se estampaban en el archivo. Solución: llamar a `spToMd` de forma incondicional tras `mdToSp` en el flujo de sync inicial, ejecutando la verificación solo con fines de logging.

**Bug #18 — Race condition de doble file watcher en `startSyncSession`**
`startSyncSession` llamaba a `performInitialSync(session)` (sin await) e inmediatamente después llamaba a `startFileWatcher`. Como `performInitialSync` detiene el watcher al inicio de su bloque `finally` y arranca uno nuevo al final, había dos intervalos de polling solapados: el de `startSyncSession` (nunca parado correctamente) y el del `finally` de `performInitialSync`. Solución: eliminar la llamada a `startFileWatcher` de `startSyncSession` — `performInitialSync` ya gestiona íntegramente el ciclo de vida del watcher.

**Bug #19 — `setupWindowFocusTracking` registraba un nuevo listener en cada llamada a `initSyncRegistry`**
Como `setupWindowFocusTracking()` se llamaba dentro de `initSyncRegistry`, y `initSyncRegistry` se llama cada vez que cambian las vinculaciones, se acumulaban múltiples listeners de cambio de foco con el tiempo. Solución: añadir un flag de módulo `focusTrackingActive` (mismo patrón que `hooksRegistered`) para que el listener se registre una sola vez.

**Bug #20 — Los títulos de sección Markdown (`## ...`) se consumían como notas de tarea**
Las líneas como `## Tareas completadas` que aparecían entre líneas de tarea eran capturadas por la rama "línea no-tarea → añadir a notas de la tarea actual" del parser. Esto eliminaba el prefijo `##` y adjuntaba el texto como nota de la tarea anterior. Solución en `parseMarkdownWithErrors`: las líneas que coinciden con `/^#{1,6}\s/` se tratan ahora como delimitadores de sección — resetean `currentTaskIndex` y `parentStack` para que las líneas siguientes no se acumulen en la tarea anterior, y no se añaden a las notas de ninguna tarea. Las tareas que aparecen después de un título de sección se siguen parseando normalmente.

## Limpieza de código (misma ronda)

- `src/background/ui-bridge.ts` eliminado — el fichero estaba intencionalmente vacío tras eliminar el bridge de `postMessage` (SP inyecta `PluginAPI` directamente en el iframe; no se necesita ningún bridge). No estaba importado en ningún sitio.
- `src/index.ts` eliminado — re-exportaba módulos usados solo por el entry point del build (`background.ts`); el build nunca referenciaba `index.ts`.
- Cinco ficheros de test placeholder/debug eliminados: `debug-subtask-issue.test.ts`, `debug-subtask-cleanup.test.ts`, `subtask-order-mismatch.test.ts`, `user-exact-scenario.test.ts`, `simple-debounce.test.ts`. Todos contenían bien un único placeholder `expect(true).toBe(true)` bien tests del `setTimeout` nativo de JavaScript (no lógica del plugin).
- `plugin-api-mock.ts` actualizado: valores de `PluginHooks.ANY_TASK_UPDATE` y `PROJECT_LIST_UPDATE` corregidos de mayúsculas a camelCase para coincidir con las constantes `SP_HOOKS` de `sync-manager.ts`.
- `manifest.json`: eliminado `"onMessage"` de la lista de permisos — esta API no existe en el runtime de plugins de SP.

## Resultados de verificación final (Ronda 2)

- **Tests**: 258/258 pasan en 30 suites (`npm test`). La reducción desde 271/36 refleja la eliminación de los ficheros de test placeholder.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).

---

## Ronda 3 — Fusión en sitio para el write-back SP→Markdown (Mayo 2026)

Tras la segunda ronda de correcciones, el plugin se usó con archivos Markdown que contenían títulos de sección (`## …`) intercalados entre líneas de tarea. La sync inicial preservaba correctamente los títulos de sección en el archivo (corrección del Bug #20); sin embargo, cada write-back SP→Markdown posterior (`spToMd`) regeneraba el archivo desde cero, descartando todo el contenido no-tarea.

**Causa raíz**: `spToMd` combinaba `convertTasksToMarkdown` (que genera el bloque completo de tareas) con la extracción de la cabecera, y luego escribía el resultado. Los títulos de sección y otro Markdown estructural dentro del área de tareas no se preservaban en este modelo.

**Bug #21 — `spToMd` destruía el contenido no-tarea en cada write-back**

El comportamiento deseado es: **solo deben modificarse las líneas de casilla de verificación**; el resto de líneas del archivo (títulos de sección, líneas en blanco, notas, cualquier Markdown libre) debe preservarse exactamente tal cual.

**Corrección**: Se introdujo un helper `mergeSpIntoExistingFile` en `sp-to-md.ts` y se actualizó `spToMd` para usarlo cuando el archivo ya existe:

- **Línea de tarea con `<!--id-->` conocido** → se actualiza el estado de la casilla y el título en sitio; se preserva la indentación original.
- **Línea de tarea con `<!--id-->` desconocido** (tarea eliminada en SP) → se elimina la línea; también se eliminan las líneas de nota inmediatamente posteriores (no-tarea, no-vacías, no-encabezado-de-sección).
- **Línea de tarea sin `<!--id-->`** → se mantiene sin cambios (se estampará el ID en el próximo ciclo Markdown→SP).
- **Resto de líneas** (títulos de sección, líneas en blanco, notas, Markdown libre) → se mantienen exactamente como están, de forma incondicional.
- **Tareas nuevas en SP no encontradas en el archivo** → se añaden al final mediante `convertTasksToMarkdown`.
- **El archivo no existe** → se recurre al camino existente de generación desde cero con `convertTasksToMarkdown`.

**Consecuencia para las notas**: Las notas de las tareas en el archivo Markdown se preservan ahora tal cual. Las notas modificadas en SP no se escriben de vuelta al archivo Markdown — el archivo es la fuente de verdad para el contenido de las notas.

**Actualización de tests**:
- `sp-to-md.test.ts`: Se añadió un nuevo bloque `describe('mergeSpIntoExistingFile')` con 11 tests unitarios que cubren todos los casos de fusión (actualización de casilla, renombrado de título, preservación de títulos de sección, preservación de líneas en blanco, preservación de notas, eliminación de tarea borrada con sus notas, supervivencia del título de sección tras una tarea borrada, passthrough de tarea sin ID, anexado de nuevas tareas, preservación de cabecera del documento, preservación de indentación de subtarea).
- `header-preservation.integration.spec.ts`: Se actualizó el test "should handle empty header" para usar `readTasksFile` devolviendo `null` (archivo no existe → camino de generación desde cero), ya que el camino de fusión en sitio mantiene las líneas de tarea sin ID preexistentes en lugar de reemplazarlas.

## Resultados de verificación final (Ronda 3)

- **Tests**: 271/271 pasan en 30 suites (`npm test`). El aumento desde 258 refleja los 13 nuevos tests de fusión.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).

---

## Ronda 4 — Correcciones tras pruebas reales (Mayo 2026)

**Bug #22 — La fusión en sitio añadía tareas duplicadas en la sync inicial para ficheros sin IDs**

Cuando `spToMd` se llamaba tras `mdToSp` durante la sync inicial, las líneas de tarea sin `<!--id-->` (tareas escritas manualmente) se conservaban tal cual por la fusión. Las tareas de SP correspondientes (recién creadas por `mdToSp`) no se encontraban en el fichero y se añadían al final, dejando dos copias de cada tarea — la línea original sin ID y la nueva con ID — lo que causaba duplicados al reiniciar.

**Corrección**: `mergeSpIntoExistingFile` ahora intenta un emparejamiento por título para las líneas sin ID. Si existe una tarea de SP con el mismo título que no haya sido emparejada aún, la línea sin ID se actualiza en sitio estampando el ID. El emparejamiento tiene en cuenta el contexto: prefiere tareas de SP con `parentId` para líneas indentadas y tareas raíz para líneas no indentadas, con fallback al primer candidato disponible. Las líneas sin tarea coincidente se conservan sin cambios.

**Bug #23 — `syncAllNow` (botón Sync Now) solo hacía SP→MD**

El botón "Sync Now" de la cabecera solo lanzaba `spToMd`, ignorando los cambios manuales que el usuario hubiera hecho en el fichero Markdown desde la última sync automática.

**Corrección**: `syncAllNow` ahora ejecuta una sync bidireccional completa — primero MD→SP (importa los cambios manuales del fichero) y luego SP→MD (escribe el estado de SP de vuelta al fichero con los IDs). Ambos timers de debounce se cancelan antes de iniciar la sync.

**Bug #24 — El label del botón de cabecera mostraba el nombre antiguo del plugin**

El label de `registerHeaderButton` era `'Sync Now'` y el mensaje del snack hacía referencia a `'sync.md'` (el nombre del plugin original de una sola vinculación).

**Corrección**: Label actualizado a `'sync.md Multi: Sync Now'`; mensaje del snack actualizado a `'sync.md Multi: bidirectional sync triggered'`.

**Mejora — Selector de fichero en la UI de vinculaciones**

El campo de ruta del fichero ahora tiene un botón **Browse…** que abre un panel de navegación de ficheros construido con `executeNodeScript`. El panel muestra solo directorios y ficheros `.md` (ficheros ocultos excluidos), permite navegar por subdirectorios y rellena el campo de ruta al seleccionar un fichero. El panel arranca desde el directorio del path ya introducido, o desde el home.

El drag & drop sobre el campo de ruta también se ha corregido: se suprimen los eventos `dragover`/`drop` a nivel de documento para evitar que Electron abra el fichero arrastrado en la aplicación por defecto del sistema. El handler de drop usa `text/uri-list` del DataTransfer (que contiene la URI `file://` completa incluso en iframes sandboxed) para extraer la ruta absoluta.

## Resultados de verificación final (Ronda 4)

- **Tests**: 274/274 pasan en 30 suites (`npm test`). El aumento desde 271 refleja los nuevos tests de fusión por título.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).

---

## Ronda 5 — Ciclo de vida de bindings y desplegable de proyectos (Mayo 2026)

Se reportaron tres bugs de uso real relacionados con la gestión de bindings desde la UI de configuración.

**Bug #25 — Crear o eliminar un binding requería reiniciar la app**

Tras guardar un nuevo binding (o eliminarlo) desde el panel de configuración, el motor de sincronización en background no recogía el cambio. El binding solo se activaba (o desactivaba) tras reiniciar la aplicación.

Causa raíz: `persistedDataUpdate` se dispara inmediatamente cuando se llama a `persistDataSynced`, antes de que SP haya comprometido completamente el nuevo valor en el almacenamiento. El handler llama entonces a `loadSyncedData()` y lee el JSON de bindings *anterior* (stale). Como coincide con `activeBindingsJson`, `initSyncRegistry` nunca se llama.

Corrección: Se añadió un delay de 200 ms en el handler de `persistedDataUpdate` antes de llamar a `loadSyncedData()`, dando tiempo a SP para que confirme la escritura. Adicionalmente, la lógica de detección se extrajo en una función independiente `checkForConfigChanges()` y se añadió un **intervalo de polling de 5 segundos** como fallback fiable — si el hook se dispara con datos stale, el poll detectará el cambio en un máximo de 5 segundos. `background.ts` también se simplificó: `refreshProjectsCache()` ahora usa una variable `currentConfig` a nivel de módulo en lugar de recibirla como parámetro, y rastrea `cachedProjectsJson` para evitar escrituras redundantes que de otro modo provocarían un bucle infinito de `persistedDataUpdate`.

**Bug #26 — Un proyecto recién creado en SP no aparecía en el desplegable de bindings**

Tras crear un proyecto nuevo en Super Productivity, abrir el panel de configuración de bindings no mostraba el nuevo proyecto. El proyecto solo aparecía tras reiniciar la aplicación.

Causa raíz (dos factores combinados):
1. `projectListUpdate` puede no dispararse en la *creación* de proyectos (solo en renombrado/reordenación/eliminación) en algunas versiones de SP.
2. Incluso cuando se dispara, `refreshProjectsCache()` actualiza `_cachedProjects` en el almacenamiento, pero el panel de UI ya había cargado los datos anteriores y no escuchaba actualizaciones.

Corrección (enfoque de tres capas, reproduciendo el comportamiento del plugin `sync.md` original):
- **Llamada directa a `getAllProjects()` desde el iframe**: `loadProjects()` ahora llama a `PluginAPI.getAllProjects()` directamente desde el iframe al abrir el panel (igual que el plugin original single-project). Si el resultado contiene más de un proyecto, se usa de inmediato — lista siempre fresca sin delays de caché.
- **Fallback al caché**: Si `getAllProjects()` devuelve solo una entrada (Inbox — observado cuando el contexto del iframe aún no se ha inicializado completamente), se usa la lista `_cachedProjects` mantenida por el background.
- **Auto-reintento**: Si solo se devuelve Inbox, `loadProjects()` reintenta automáticamente hasta 3 veces, con 2 segundos de separación (misma lógica de retry que el plugin original), esperando a que SP tenga la lista completa disponible.
- **Hook `persistedDataUpdate` en el iframe**: La UI ahora registra `persistedDataUpdate` en el iframe. Cuando el background escribe un `_cachedProjects` actualizado (p. ej. tras dispararse `projectListUpdate`), el hook recarga el desplegable de proyectos automáticamente — así un proyecto nuevo aparece sin que el usuario tenga que cerrar y reabrir el panel.
- **Botón ↺ Refresh manual**: Se añadió un pequeño botón de refresco junto al desplegable de proyectos como escape hatch inmediato garantizado.
- **Polling de background cada 60 s**: `background.ts` ahora hace polling de `getAllProjects()` cada 60 segundos y actualiza `_cachedProjects` si la lista ha cambiado, como fallback adicional por si `projectListUpdate` nunca se disparó.

**Mejora — El desplegable de proyectos solo muestra proyectos sin binding**

El desplegable ahora filtra los proyectos que ya tienen una vinculación activa, haciendo imposible crear accidentalmente dos bindings para el mismo proyecto (lo que provocaría que ambos ficheros Markdown reflejaran el mismo proyecto de SP y compitieran en cada sync). En modo edición, el proyecto del propio binding se reincluye para que siga siendo seleccionable. El desplegable se reconstruye en cada acción relevante: apertura del panel, clic en Edit, Cancel, guardar y eliminar.

**Investigación — Drag & drop de ficheros `.md` confirmado como no implementable**

Se investigó y diagnosticó una funcionalidad de drag & drop para el campo de ruta del fichero, con instrumentación de consola. Resultado: SP captura los eventos de arrastre a nivel de ventana de Electron antes de que lleguen al iframe del plugin — `dragenter`, `dragover` y `drop` nunca se disparan en el contexto JavaScript del iframe. Es una limitación de la arquitectura del sandbox de plugins de SP y no tiene solución desde dentro del plugin. El navegador de ficheros inline **Browse…** (añadido en v0.0.5) es la alternativa recomendada.

## Resultados de verificación final (Ronda 5)

- **Tests**: 274/274 pasan en 30 suites (`npm test`). Sin cambios en tests.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).

---

## Ronda 6 — Detección de movimientos de tareas e investigación de hooks (Mayo 2026)

**Bug #27 — Las tareas movidas entre proyectos no se reflejaban en los ficheros Markdown**

Mover una tarea del Proyecto A al Proyecto B mediante drag & drop o menú contextual no actualizaba ningún fichero Markdown automáticamente. La tarea permanecía en el fichero del Proyecto A y nunca aparecía en el del Proyecto B. Pulsar **Sync Now** tras un movimiento reimportaba la tarea al Proyecto A (ya que MD→SP se ejecutaba primero), deshaciendo el movimiento.

**Investigación**: Se añadió instrumentación de consola a todos los hooks candidatos (`anyTaskUpdate`, `taskUpdate`, `projectListUpdate`) para observar cuáles despacha SP durante un movimiento de tarea. Resultados:

- `anyTaskUpdate` se dispara para ediciones normales de tarea (título, notas, completado) pero **no** para movimientos entre proyectos.
- `projectListUpdate` tampoco se dispara para movimientos entre proyectos.
- `taskUpdate` (el nombre de hook declarado en el enum publicado `PluginHooks` como `TASK_UPDATE = "taskUpdate"`) **sí** se dispara para movimientos. Su payload incluye un objeto `changes` con `projectId` establecido al proyecto destino — identificando inequívocamente el evento como un movimiento.

El plugin `sync.md` original usa una build local (interna) de la API de plugins donde `PluginHooks.ANY_TASK_UPDATE` resuelve a la misma cadena que `taskUpdate`. La versión multi-proyecto usaba el string literal `'anyTaskUpdate'` (el nombre legacy del hook), que SP ya no despacha en movimientos.

**Corrección**: `setupGlobalHooks()` ahora registra `taskUpdate` como hook principal. Cuando `changes.projectId` está presente en el payload, se notifican todas las sesiones (ambos ficheros origen y destino se actualizan). Para ediciones normales, solo se notifica la sesión que coincide con `task.projectId`. El hook `anyTaskUpdate` se mantiene como fallback legacy para versiones antiguas de SP; su timer de debounce se resetea en lugar de duplicar la sync si ambos hooks se disparan para el mismo evento.

**Mejora en el orden de Sync Now**: Como mejora relacionada, `syncAllNow()` se actualizó para ejecutar SP→MD primero (luego MD→SP), de modo que una sync manual también captura correctamente los movimientos que no dispararon ningún hook.

## Resultados de verificación final (Ronda 6)

- **Tests**: 274/274 pasan en 30 suites (`npm test`). Sin cambios en tests.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).

---

## Ronda 7 — Renderizado del botón de cabecera en Mac (Junio 2026)

**Bug #28 — Botón "Sync Now" de cabecera no se renderiza en macOS**

En macOS (Apple Silicon, SP 18.9.1) `PluginAPI.registerHeaderButton` retornaba sin error pero no aparecía ningún botón en la barra de SP. La misma llamada se renderizaba correctamente en Linux (AppImage), por lo que ni el uso de la API ni la configuración del botón eran el problema.

**Investigación**: La llamada de registro estaba al **final** de la IIFE `async` del punto de entrada del background (`background.ts`), después de dos `await` — `loadSyncedData()` y `refreshProjectsCache()` (que a su vez espera `getAllProjects()` + `persistDataSynced()`). La entrada de menú (registrada en el mismo punto) sí aparecía, pero el botón de cabecera no — coherente con que SP construye su barra de cabecera **una sola vez** al cargar el plugin, mientras que el menú lateral se renderiza de forma reactiva. En Mac los `await` se resolvían después de que la barra ya estuviera construida, así que el registro tardío nunca se pintaba; en Linux el registro ganaba la carrera.

**Corrección**: `registerMenuEntry` y `registerHeaderButton` se llaman ahora de forma **síncrona al principio de la IIFE, antes de cualquier `await`**, de modo que el registro siempre se completa antes de que SP construya la barra. Ambas llamadas van envueltas en `try/catch` con registro de éxito/fallo (`log.log`/`log.error`) para que la consola distinga "nunca registrado" (excepción silenciosa de la API) de "registrado pero no pintado" (renderizado del lado de SP). Verificado en Mac: el botón ahora se renderiza y se imprime la línea de log `Header button registered`.

## Resultados de verificación final (Ronda 7)

- **Tests**: 274/274 pasan en 30 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Manual**: Botón confirmado como visible en la barra de SP en macOS 18.9.1 tras reinstalar.

---

## Ronda 8 — La sync inicial no se disparaba al crear un binding (Junio 2026)

**Bug #29 — Crear/editar un binding no disparaba la sync hasta reiniciar la app (macOS)**

Al crear o editar un binding desde el panel de configuración en macOS (SP 18.9.1D), el cambio no se detectaba en vivo: el binding solo se activaba tras reiniciar SP. Al reiniciar funcionaba porque el arranque llama a `initSyncRegistry` directamente con la config ya persistida.

**Investigación**: Un log de la consola de desarrollador (con instrumentación temporal) fue decisivo. Mostraba:

```
Uncaught (in promise) Error: Error on typia.assert(): invalid type on $input,
expect to be (… | "persistedDataChanged" | "projectListUpdate" | … )
```

Los nombres de hook válidos en SP 18.9.1D incluyen **`persistedDataChanged`** pero **no** `persistedDataUpdate`. El plugin (tanto el punto de entrada del background como el iframe de `index.html`) registraba `persistedDataUpdate`, que SP rechaza por validación typia — así que **ese hook nunca se disparaba**. La detección de cambios de config en vivo dependía entonces solo del poll de 5 segundos, que no compensaba (estaba detrás de un `await refreshProjectsCache()` en el IIFE de arranque que podía retrasarlo).

Esto contradice la asunción previa del proyecto de que el rename del hook era exclusivo de SP 18.10.0 y que `nodeExecution` estaba roto en SP nuevas — en 18.9.1D el hook ya es `persistedDataChanged` y `nodeExecution` funciona.

**Corrección**:
1. Renombrado el hook `persistedDataUpdate` → `persistedDataChanged` en `background.ts`, `index.html` y `manifest.json`.
2. Reordenado el IIFE del background para que el hook `persistedDataChanged` y el poll de 5 segundos se registren **antes** del `void refreshProjectsCache()` no crítico (que ya no bloquea el cableado de la detección). Mismo tipo de corrección de orden que la carrera del botón de cabecera en macOS (Bug #28).

## Resultados de verificación final (Ronda 8)

- **Tests**: 274/274 pasan en 30 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Manual (macOS 18.9.1D)**: Añadir un binding (3→4) y eliminar otro (4→3) disparan ambos `persistedDataChanged hook fired` → `Config change detected — restarting sync registry` y sincronizan **sin reiniciar la app**. Sin errores typia en consola.

---

## Ronda 9 — Indentación de subtareas en la escritura SP→MD (Junio 2026)

**Bug #30 (issue #12) — Las subtareas de SP se escriben en el Markdown como lista plana, sin indentar**

Cuando se añadía una subtarea en SP bajo un padre que **ya estaba** en el fichero Markdown, la escritura SP→MD ponía la subtarea plana (sin indentación) y desligada al final del fichero, en lugar de indentada bajo su padre.

**Causa raíz**: `mergeSpIntoExistingFile` añade las tareas "nuevas" de SP (las que no están ya en el fichero) al final vía `convertTasksToMarkdown`. Una subtarea nueva cuyo padre ya estaba en el fichero llega ahí **sola** (el padre no es "nuevo"), así que `convertTasksToMarkdown` la trata como huérfana (camino `orphanedSubtasks`) y la escribe sin indentación. Generar un fichero desde cero funcionaba, por eso los tests de `convertTasksToMarkdown` pasaban — `mergeSpIntoExistingFile` no tenía cobertura de subtareas.

**Corrección**: en `mergeSpIntoExistingFile`, las subtareas nuevas cuyo padre ya está en el fichero se **insertan indentadas, justo bajo ese padre** (tras su bloque de subtareas existente), ordenadas según el `subTaskIds` del padre. Los padres totalmente nuevos con sus subtareas siguen añadiéndose al final (correctamente anidados). (En SP el padre se crea siempre antes que sus subtareas, así que el caso "padre+subtareas nuevos en una sola escritura" no se da en la práctica.)

**Seguimiento (de la prueba en Mac)**: el primer arreglo reescribía la indentación con espacios dimensionados por **longitud** de caracteres. Los ficheros del usuario indentan las subtareas con un **tabulador** (`\t`, longitud 1), así que la subtarea nueva salía con un solo espacio. Se añadió `detectIndentString`, que detecta y reutiliza el **string real** de indentación del fichero (tab o N espacios) para que las subtareas nuevas igualen exactamente a las existentes y el round-trip del parser siga siendo consistente.

**Además**: se estabilizó el benchmark inestable `should not leak memory with repeated parsing`. Los deltas de `process.memoryUsage().heapUsed` solo tienen sentido tras un GC forzado; bajo `npm test` (sin `--expose-gc`) el delta lo dominaban asignaciones no relacionadas de otras suites. El assert ahora está condicionado a la disponibilidad de `global.gc` (ejecutar con `node --expose-gc` para el check real); `parseMarkdown` no tiene estado, así que no hay leak real.

## Resultados de verificación final (Ronda 9)

- **Tests**: 278/278 pasan en 30 suites (`npm test`), deterministas en ejecuciones repetidas.
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Manual (macOS 18.9.1D)**: Añadir una subtarea en SP bajo un padre existente ahora la escribe indentada con tabulador, igual que las subtareas existentes del fichero.

---

## Ronda 10 — Gestión de recursos ausentes y flujo de recreación (Julio 2026)

Esta ronda introdujo la **gestión de recursos ausentes** (v0.1.4/v0.1.5). Cuando una sync detecta que el fichero `.md` de un binding falta, o que su proyecto de SP ha sido eliminado, el plugin muestra ahora un diálogo modal (`PluginAPI.openDialog`) que pide al usuario **Recrear**, **Eliminar binding** o **Ignorar** — un binding nunca debe seguir funcionando en estado roto. Esta sección documenta la construcción de la funcionalidad y los bugs encontrados al probarla en SP 18.13.1 (macOS M2).

**Bug #32 — El diálogo y la recreación usaban el nombre del fichero en lugar del nombre del proyecto**

El diálogo de proyecto eliminado, y el proyecto recreado desde él, tomaban el nombre del fichero `.md` del binding en lugar del proyecto de SP.

**Causa raíz**: el binding nunca almacenaba el título del proyecto, y SP no expone el nombre de un proyecto ya eliminado — cuando la sync detecta la eliminación, el nombre ya no está disponible.

**Corrección**: almacenar `projectTitle` en el binding, capturado en cada sync mientras el proyecto todavía existe. El diálogo de proyecto eliminado muestra entonces el nombre real del proyecto, y **Recrear** crea el nuevo proyecto con el nombre original. Si nunca se capturó un título (p. ej. un proyecto eliminado antes de cualquier sync correcta), se recurre al nombre del fichero.

**Bug #33 — Recrear un proyecto provocaba un error de "formato markdown"**

Elegir **Recrear** para un proyecto eliminado hacía fallar la importación con un error de formato Markdown.

**Causa raíz**: el fichero `.md` reimportado al proyecto recién creado seguía llevando los marcadores `<!--taskId-->` del proyecto **anterior**. La importación generaba por tanto operaciones de *actualización* para tareas que ya no existían, y el batch fallaba.

**Corrección**: `stripTaskIds` elimina esos marcadores antes de reimportar, de modo que cada tarea se crea de nuevo en el nuevo proyecto. También consume el espacio posterior a cada marcador, para que los títulos de tarea no queden con un espacio inicial sobrante. `spToMd` estampa después los nuevos IDs de vuelta en el fichero una vez la importación tiene éxito.

**Bug #34 — Proyectos duplicados intermitentes al recrear (el difícil)**

Recrear un proyecto eliminado producía a veces **múltiples proyectos** (se observaron 4–6), algunos creados con el nombre equivocado — una cascada en lugar de una recreación limpia y única.

**Endurecimiento provisional** (ayudó, pero no lo arregló del todo): todas las escrituras de config se serializaron a través de una única cola; la config en memoria se convirtió en la fuente de verdad para que una lectura obsoleta del almacenamiento no pudiera revertir un repunte de binding en curso; se añadieron un guard de diálogo por binding más un cooldown tras el cierre; se introdujo un lock `recreatingBindings` para romper el bucle de realimentación `addProject → projectListUpdate → recomprobar → recrear`; y el flujo de recreación ahora espera a que el nuevo proyecto sea visible en `getAllProjects()` antes de importar.

**Causa raíz** (hallada mediante logging de diagnóstico): **instancias zombis del plugin**. SP desregistra los hooks de un plugin cuando se recarga/reinstala, pero **no** detiene los timers `setInterval` propios del plugin — el poll de config de 5 segundos y los file watchers. Sin teardown, cada reinstalación durante las pruebas dejaba una instancia antigua todavía haciendo polling, todavía capaz de mostrar diálogos y crear proyectos, peleando con la nueva instancia por la config persistida compartida.

**Corrección**: implementar `plugin.onUnload()` — `shutdownSyncRegistry` libera todas las sesiones y watchers y limpia el poll de config. Tras un reinicio limpio de SP (para eliminar los zombis existentes) más la build con `onUnload`, las pruebas produjeron exactamente un proyecto por eliminación del usuario, con nombres correctos, sin cascada, sin flip-flop de config y sin errores.

**Aprendizaje de plataforma**: la promesa de `openDialog` de SP se resuelve cuando el diálogo se **muestra**, no cuando se pulsa un botón — así que la lógica de guard no puede basarse en esperarla (`await`).

**Nota (v0.1.5)**: se añadió un botón **Ignorar** al diálogo de proyecto eliminado. El razonamiento previo de "sin Ignorar" era incompleto — un proyecto eliminado *puede* arreglarse externamente (crear un proyecto y luego reapuntar el binding en el panel de configuración), así que Ignorar es una opción legítima.

## Resultados de verificación final (Ronda 10)

- **Tests**: 304/304 pasan en 33 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.13.1, M2)**: Flujos de fichero ausente y proyecto eliminado verificados de extremo a extremo — Recrear/Eliminar binding/Ignorar se comportan correctamente, un proyecto por recreación, nombres correctos, sin cascada ni errores. Publicada como **v0.1.4** (con ZIP); subida a **v0.1.5**.

---

## Ronda 11 — Anotación `@done` + limpieza opcional del `.md` (Julio 2026)

Esta ronda entregó las dos funcionalidades restantes del plugin (v0.2.1), completando el alcance previsto del plugin.

**Funcionalidad — anotación `@done(YYYY-MM-DD HH:mm)`**

Completar una tarea escribe ahora una marca `@done` en hora local — derivada de `task.doneOn` de SP — en su línea de casilla Markdown; reabrir la tarea la elimina. Las tareas activas se quedan sin etiqueta. La operación es idempotente: resincronizar una tarea completada no duplica ni reforma la etiqueta. Al leer, el parser elimina cualquier `@todo` / `@doing` / `@done(...)` al final de la línea para que el título de la tarea en SP quede limpio, y acepta las formas solo-fecha, fecha+hora y desnuda.

Decisión de diseño: **solo se escribe `@done`**. `@todo` / `@doing` quedan deliberadamente fuera de alcance porque SP solo expone un estado hecho/no-hecho (no hay un booleano limpio de "en curso" al que mapear `@doing`); esas etiquetas se reservan para la app independiente Taskdown, cuyo modelo sí las distingue. Implementación: `stripStatusTags` (parser) más `formatDoneTag` / `buildTaskLine` — un único renderizador de línea usado en todos los sitios donde se emite una línea de tarea, de modo que el formato de la etiqueta se produce en un solo lugar.

**Funcionalidad — limpieza opcional del `.md` al eliminar un binding**

Eliminar un binding ya no deja silenciosamente los marcadores `<!--taskId-->`. La confirmación de eliminación ofrece ahora tres opciones — **Eliminar binding** / **Eliminar + limpiar fichero** (quitar los marcadores `<!--taskId-->`) / **Cancelar** — presentadas mediante el `PluginAPI.openDialog` nativo de SP desde el iframe de configuración, con un modal propio como fallback. La reescritura del fichero se realiza con `executeNodeScript`. Es opcional, de modo que una eliminación nunca reescribe el fichero del usuario salvo que él lo pida explícitamente.

Se encontraron y corrigieron dos bugs al probar estas funcionalidades.

**Bug #35 — se perdía el `@done(fecha)` importado al escribir de vuelta**

Importar un fichero cuya línea de tarea ya llevaba `@done(2026-07-07 14:30)` y luego sincronizar de vuelta lo colapsaba a un `@done` desnudo — se perdía la fecha.

**Causa raíz**: el plugin es *solo de escritura* para la fecha de completado. SP no almacena una fecha de completado leída del fichero, así que tras importar `task.doneOn` es `null`; la línea se regeneraba entonces a partir de ese `doneOn` nulo y producía una etiqueta desnuda.

**Corrección**: `extractDoneTag()` preserva un `@done(fecha)` ya presente en la línea cuando la tarea sigue completada. Una tarea recién completada en SP (sin etiqueta previa en el fichero) sigue tomando su fecha de `doneOn`, así que ambos caminos conservan una marca de tiempo correcta.

**Bug #36 — tareas duplicadas para líneas sin ID que llevan una etiqueta de estado**

Importar tareas nuevas escritas con una etiqueta `@done`, y luego replicar de vuelta, dejaba las originales sin ID y añadía copias idénticas debajo — cada una con un ID y un `@done` desnudo.

**Causa raíz**: la fusión en sitio emparejaba las líneas sin ID por su título **crudo**, que incluía la etiqueta `@done`. Ese título crudo nunca coincide con el título limpio de SP, así que la línea no se emparejaba y la tarea de SP se trataba como nueva y se añadía.

**Corrección**: eliminar las etiquetas de estado del título de la línea antes del emparejamiento por título, de modo que `- [x] Tarea @done(...)` coincida con su tarea limpia de SP y reciba su ID estampado en sitio en lugar de duplicarse.

## Resultados de verificación final (Ronda 11)

- **Tests**: 328/328 pasan en 34 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.13.1, M2)**: Ambas funcionalidades verificadas de extremo a extremo — escritura/borrado de `@done` al completar/reabrir, fechas importadas preservadas, limpieza opcional del fichero al eliminar un binding, sin duplicados. Publicada como **v0.2.1** (con ZIP); subida a **v0.2.2**. Ambas funcionalidades restantes del plugin quedan cerradas — el plugin está completo en funcionalidades para su alcance.

---

## Ronda 12 — Correcciones de la revisión del plugin comunitario: XSS, Sync Now, cascada (Julio 2026)

Esta ronda atendió los tres bloqueantes que Johannes Millan planteó al revisar el PR de alta en la lista de plugins comunitarios (super-productivity#9323), publicados como **v0.3.0**.

**Bug #37 — Inyección de HTML en la UI de configuración (XSS → RCE)**

El panel de configuración construía su lista de vinculaciones con `innerHTML`, interpolando directamente en el marcado los títulos de proyecto, las rutas de fichero y los nombres de las entradas del explorador de ficheros. Un proyecto titulado `<img src=x onerror=…>` — o un nombre de fichero/directorio manipulado mostrado por el explorador — ejecutaría script arbitrario dentro del iframe del plugin, y como el plugin tiene `nodeExecution`, eso escala a código arbitrario en la máquina.

**Causa raíz**: valores dinámicos concatenados dentro de `innerHTML`.

**Corrección**: el panel se reconstruye con `document.createElement` + `textContent` + `addEventListener`, de modo que ningún valor dinámico se interpreta nunca como marcado; se añadió un helper `fbShowError` para los errores del explorador. Un test de regresión con jsdom (`config-ui-xss.test.ts`) carga el `index.html` real, inyecta nombres con forma de HTML y comprueba que hay cero `<img>` / `<script>` inyectados y ninguna ejecución de payload. (Los propios diálogos `openDialog` del plugin ya escapaban su HTML mediante `escapeHtml`; el nombre extraño que se veía al eliminar un proyecto de título HTML venía del diálogo de confirmación *propio* de SP mostrando el literal escapado — es seguro.)

**Bug #38 — "Sync Now" podía sobrescribir una edición recién hecha en el Markdown**

El botón de cabecera *Sync Now* ejecutaba SP→MD primero de forma incondicional, así que una edición del `.md` aún no importada era sobrescrita por el estado más antiguo de SP.

**Corrección**: *Sync Now* ahora importa MD→SP primero cuando el fichero cambió desde el último sync, y en caso contrario escribe SP→MD primero — en ambos casos se ejecutan las dos direcciones. (La comprobación por mtime usada aquí quedó reemplazada en v0.3.1 por un cambio por hash de contenido, Bug #42.)

**Bug #39 — El borrado de un padre arrastraba en cascada a un hijo promovido**

Eliminar una tarea padre a la vez que se promovía su hijo a tarea raíz, en una sola edición del Markdown, eliminaba también al hijo. El `delete` del padre y el `update` de reasignación del hijo se enviaban en un único `batchUpdateForProject`; el reducer de SP resuelve el borrado contra los `subTaskIds` del padre *previos al batch*, que todavía listaban al hijo, así que el borrado se propagaba en cascada a este.

**Corrección**: dividir las operaciones en dos batches ordenados — primero las que no son borrados (crear / actualizar / reordenar), y los borrados después — de modo que los `subTaskIds` del padre ya estén vacíos cuando se ejecuta el borrado y el hijo promovido sobreviva. Un test de regresión modela el reducer en cascada de SP y falla contra el antiguo código de un solo batch.

## Resultados de verificación final (Ronda 12)

- **Tests**: 336/336 pasan en 37 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.16.0D, M2)**: las tres correcciones verificadas en vivo — un proyecto de título HTML se muestra como texto escapado, el hijo promovido sobrevive al borrado de su padre, y la sync bidireccional general + `@done` + borrado de vinculación funcionan. Publicada como **v0.3.0** (con ZIP). Rango SP verificado ampliado a **v18.13.1–v18.16**.

---

## Ronda 13 — Segunda revisión del plugin comunitario: endurecimiento contra pérdida de tareas/ficheros (Julio 2026)

Al revisar v0.3.0 en #9323, Johannes señaló cinco vías deterministas de pérdida de tareas/ficheros. Esta ronda (**v0.3.1**) corrige las tres que están bajo control del propio plugin (sus puntos 2–4); el punto 1 (config local por dispositivo) queda planificado para v0.4.0, y el punto 5 (atomicidad de promoción/borrado bajo concurrencia de dos dispositivos) es un cambio en el reducer anfitrión de SP — ambos diferidos. Un bug de sync de subtareas encontrado durante las pruebas se corrigió en la misma release.

**Bug #40 — La importación continuaba tras un error de parseo y borraba tareas**

Una línea a medio escribir como `- [ ] <!--A-->` (un id de tarea conocido pero un título vacío) se reporta como error de parseo y se descarta del conjunto parseado. `mdToSp` solo mostraba un snack de aviso y continuaba; la reconciliación trata el conjunto parseado como autoritativo, así que generaba un borrado para la tarea A — perdiendo una tarea real por un estado transitorio del fichero. Secuela encontrada en las pruebas: incluso tras abortar la importación, el write-back posterior SP→MD reescribía el título antiguo de SP en el fichero.

**Corrección**: `mdToSp` devuelve `'parse-error'` y se detiene **antes** de generar ninguna operación cuando `parseResult.errors` no está vacío. Los tres llamadores (`executeMdToSpSync`, `performInitialSync`, `syncAllNow`) omiten tanto el write-back SP→MD como `markSynced` ante ese resultado, de modo que no se tocan ni las tareas de SP ni el fichero. Esto afecta también al uso mono-dispositivo. Los tests de regresión comprueban que no hay `batchUpdateForProject` ante un error de parseo ni write-back posterior.

**Bug #41 — Dos vinculaciones sobre el mismo fichero vía alias de ruta**

El guardián de rutas duplicadas del panel de configuración comparaba cadenas de ruta en crudo, mientras que la E/S del background canonicaliza con `path.resolve`. `/tmp/tasks.md` y `/tmp/./tasks.md` pasaban la comprobación de la UI pero arrancaban dos sesiones sobre un mismo fichero, corrompiéndolo.

**Corrección**: un helper `canonicalizePathKey` (colapsa `.` / `..` / `//`, unifica separadores) más `dedupeBindingsByCanonicalPath`. La comprobación de duplicados de la UI ahora canonicaliza vía `executeNodeScript` (`path.resolve` + `realpath`), y el registry rechaza vinculaciones canónicamente duplicadas como red de seguridad.

**Bug #42 — El mtime se usaba como interruptor de dirección destructivo**

*Sync Now* decidía que el fichero había cambiado solo cuando su `mtime` era más reciente que el último sync. Una edición que preservara una marca de tiempo igual o anterior, sincronizada antes de que el watcher la importara, hacía que *Sync Now* eligiera SP→MD primero y sobrescribiera la edición.

**Corrección**: se reemplazó la comparación por mtime por una **huella de contenido** (`hashContent`, un hash cyrb53) del último sync en memoria, registrada en `markSynced`; el interruptor de dirección ahora compara hashes, así que una edición se detecta independientemente de su marca de tiempo.

**Bug #43 — Añadir una subtarea no sincronizaba automáticamente**

Crear una subtarea bajo una tarea existente en SP no disparaba el write-back; solo un *Sync Now* manual la recogía. El rastreo por consola mostró que `[Task] Add SubTask` nunca llega a los hooks `taskUpdate` / `anyTaskUpdate` en los que se apoyaba el plugin.

**Corrección**: registrar el hook genérico `action` de SP, filtrado por `isStructuralTaskAction` a mutaciones estructurales de tareas (añadir / borrar / mover / convertir / restaurar de tareas y subtareas), de modo que las ediciones puras (ya cubiertas por `taskUpdate`) y las acciones de UI/selección se ignoran. Se propaga a todas las sesiones; el cooldown + debounce por sesión regulan la propagación y suprimen el eco de las propias escrituras MD→SP del plugin.

**Diferido (dueño ≠ plugin)**: **Punto 1** — las vinculaciones de fichero deberían ser locales por dispositivo. Toda la config se sincroniza entre dispositivos vía `persistDataSynced`, así que una ruta absoluta del dispositivo A puede activarse erróneamente en B y, si allí existe un fichero coincidente, tratarse como autoritativa. Diseño decidido (volver al `localStorage` + ui-bridge del `sync.md` original, local por construcción) → **v0.4.0**. **Punto 5** — bajo edición concurrente en dos dispositivos, la corrección de dos batches (Bug #39) puede hacer que la resolución de conflictos de SP rechace la promoción más antigua pero acepte el borrado más nuevo, cascadeando sobre el hijo; la corrección real es un cambio en el reducer anfitrión de SP (la cascada debe usar los `subTaskIds` *pendientes efectivos*), tras el cual el plugin podrá volver con seguridad a un solo batch. Los usuarios mono-dispositivo no se ven afectados por ninguno de los dos.

## Resultados de verificación final (Ronda 13)

- **Tests**: 363/363 pasan en 43 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.16.0D, M2)**: el aborto por error de parseo deja tareas y fichero intactos, añadir una subtarea ahora sincroniza automáticamente, y la sync bidireccional general no se ve afectada. Publicada como **v0.3.1** (con ZIP).

## Ronda 14 — Tercera revisión del plugin comunitario: configuración local del dispositivo + guarda SP→MD (Julio 2026)

La tercera revisión de #9323 por Johannes aprobó en principio la inclusión en el catálogo (confirmó de forma independiente que el ZIP publicado es un build reproducible y que los tests de regresión no son vacíos), confirmó los puntos 2–4 corregidos y degradó el punto 5 a no bloqueante. Quedaban dos bloqueantes; **v0.4.0** resuelve ambos, además de los hallazgos menores "ya que estás". El punto 5 (atomicidad de promoción/borrado bajo concurrencia de dos dispositivos) queda como interino documentado a la espera de una corrección del reductor del host de SP aguas arriba.

**El almacenamiento de configuración pasa a ser local del dispositivo (bloqueante 1)**

Toda la configuración — rutas de fichero absolutas y vinculaciones — se persistía mediante `PluginAPI.persistDataSynced`, que SP sincroniza entre los dispositivos del usuario. El peligro realista no es un fichero ajeno coincidente, sino que el `.md` vinculado esté a su vez sincronizado por archivos (Dropbox/Syncthing/iCloud) con una **copia obsoleta en el dispositivo B**: SuperSync y el transporte de sincronización de ficheros son independientes y sin orden, así que B podría tratar el fichero obsoleto como autoritativo, borrar todas las tareas del proyecto vinculado creadas desde esa instantánea y propagar los borrados de vuelta a A. Un efecto relacionado de tipo último-en-escribir-gana: un dispositivo que arranca antes de recibir la configuración de A podría persistir `bindings: []`, y si esa escritura ganaba el LWW, A adoptaría el conjunto vacío y descartaría cada sesión.

**Corrección**: la configuración vive ahora en el propio `localStorage` del contexto de background (clave `'sync-md-multi-config'`, distinta de la clave del `sync.md` integrado), que es local del dispositivo por construcción — no hay blob sincronizado que circule. El iframe en sandbox, que no puede leer ese almacenamiento directamente, se comunica ahora con el background a través de un **bridge de mensajes** `postMessage` (`getConfig` / `saveConfig` / `getProjects`); el background es el único propietario y escritor de la configuración. Esto refleja la separación background/iframe del `sync.md` integrado original. Una migración única en el arranque siembra el almacén local a partir de cualquier blob sincronizado previo a 0.4.0 y luego borra el blob. El hook `persistedDataChanged` y el poll de configuración de 5 segundos desaparecen.

**Bug #44 — El camino automático SP→MD podía sobrescribir una edición reciente de Markdown**

La comprobación de dirección por huella de contenido de v0.3.1 (Bug #42) se añadió solo a `syncAllNow`. Una edición normal en SP llega a `handleSpChange` a través de los hooks `taskUpdate` / `anyTaskUpdate` y ejecutaba `spToMd` de forma incondicional tras el debounce. Con SP sin foco, `handleFileChange` aparca una edición `.md` detectada hasta 10 s; un cambio en SP dentro de esa ventana sobrescribía la edición manual que el plugin ya había detectado. `verifySyncState` se ejecutaba en `handleSpChange` pero su resultado se descartaba.

**Corrección**: `handleSpChange` aplica ahora la misma guarda que usa `syncAllNow` — antes de `spToMd` aborta si `pendingMdToSpSync` está activo, lee el fichero, y si `fileHasUnsyncedEdit` reporta una edición no sincronizada importa MD→SP primero (abortando ante `'parse-error'`), de modo que la edición gana. Una regresión edita el fichero, dispara `taskUpdate` y comprueba que la importación se ejecutó antes del write-back.

**Bug #45 — Recrear proyecto sobrescribía un fichero malformado**

El handler de *Recrear proyecto* ignoraba el retorno `'parse-error'` de `mdToSp` y llamaba a `spToMd` + `markSynced` de forma incondicional, así que recrear un proyecto desde un `.md` malformado aún lo sobrescribía — el mismo hueco que el Bug #40 cerró para los demás llamadores.

**Corrección**: el handler de recreación comprueba ahora el resultado de `mdToSp` y se detiene (con un snack de error) ante `'parse-error'` antes de cualquier write-back.

**Bug #46 — El filtro del hook `action` clasificaba mal los tipos de acción**

`isStructuralTaskAction` usaba una prueba de subcadena que era a la vez demasiado estrecha y demasiado amplia: exigía el literal `"add task"` *con un espacio* (el tipo real de SP es `[Task Shared] addTask`, así que nunca coincidía — esas altas ya las cubre `anyTaskUpdate` de todos modos), y **sobre-coincidía** con `removeTasksFromTodayTag` / `removeTagsForAllTasks` / `[Task] Remove time spent` porque "remove" contiene "move". La prueba de subcadena además solo *accidentalmente* protegía al plugin de las aplicaciones remotas (`[OperationLog] Bulk Apply Operations`, `[SP_ALL] Load(import) all data`) — un renombrado podría haber disparado un write SP→MD completo en cada sincronización remota.

**Corrección**: se reemplazó la prueba de subcadena por un normalizador (`normalizeActionType` elimina todos los grupos `[…]` iniciales y los caracteres no alfabéticos) contrastado con un **conjunto conocido** de nombres de acción estructurales. Los tests de regresión comprueban que las trampas de "remove" y las aplicaciones remotas/masivas devuelven todas false.

**Limpieza — eliminadas guardas muertas de `executeNodeScript`**

`file-utils.ts` y `file-watcher.ts` protegían con `if (!PluginAPI.executeNodeScript)`, pero SP enlaza `executeNodeScript` de forma incondicional (devuelve `{ success: false }` fuera del escritorio), así que esas ramas nunca se ejecutaban. Eliminadas, con una NOTE que explica el contrato fuera del escritorio.

## Resultados de verificación final (Ronda 14)

- **Tests**: 384/384 pasan en 46 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS, M2)**: la carga/guardado de configuración local del dispositivo a través del bridge de mensajes, la migración desde un blob sincronizado previo a 0.4.0 y la guarda de `handleSpChange` que preserva una edición `.md` reciente se verifican en vivo en SP antes de la release v0.4.0.

---

## Ronda 15 — Reubicación padre/hijo, diálogo proactivo de proyecto eliminado e importación con ids ajenos (v0.4.2–v0.4.5, septiembre 2026)

Tres bugs reportados por el usuario y una carencia de paridad de UX, todos hallados en uso diario tras el listado en el catálogo.

**Bug #47 — un cambio de `parentId` en SP nunca se escribía en el `.md`, y la siguiente sincronización lo revertía (v0.4.2)**

Promover una subtarea a tarea de primer nivel en SP (por menú contextual *o* arrastrando) no escribía nada en el fichero Markdown, y la sincronización siguiente deshacía la promoción en SP. El caso espejo — degradar una tarea raíz a subtarea — fallaba igual: el bug se dispara ante **cualquier** cambio de `parentId`, en ambas direcciones.

Causa raíz: el merge in-place `mergeSpIntoExistingFile` reemite cada línea de tarea con id **conservando literalmente el espaciado inicial original del fichero** — refresca la casilla y el título, nunca el nivel de anidamiento. Así, tras una promoción la línea seguía indentada, se seguía parseando como subtarea, SP→MD producía un fichero byte-idéntico y la relectura MD→SP volvía a colgar la tarea de su padre anterior. Un *Sync Now* manual lo reproduce exactamente: primero SP→MD (aquí un no-op), luego MD→SP (re-emparentado).

La corrección no podía limitarse a des-indentar la línea in situ — una subtarea promovida con hermanas por detrás habría capturado esas hermanas como subárbol propio. En su lugar, el bucle del merge sigue ahora el **padre según el fichero** de cada línea con id mediante una pila de indentación, y cuando la ubicación en el fichero discrepa del `parentId` de SP la línea **no** se emite ni se marca como vista: cae en la distribución de tareas nuevas posterior al bucle, que ya coloca correctamente tareas raíz y subtareas y por tanto resuelve ambas direcciones de forma simétrica. Sus líneas de nota viajan con ella, y se amplió `insertNewSubtasksUnderParents` para emitir las notas de una subtarea (una carencia que afectaba también a subtareas realmente nuevas). Un commit posterior hizo que el merge refleje el **orden de subtareas y la posición de reubicación** dentro del grupo, de modo que una tarea reubicada aterriza donde SP la dejó y no al final del grupo.

El orden a nivel raíz queda deliberadamente fuera de alcance y se documenta como limitación conocida: una tarea promovida a raíz se añade al final del fichero y la siguiente relectura reordena SP para casar con él — funcionalmente correcto y estable en una sola sincronización, pero visible.

**Bug #48 — el diálogo de "proyecto de SP eliminado" solo aparecía tras un Sync Now manual (v0.4.5)**

Eliminar en SP un proyecto vinculado no provocaba ninguna reacción del plugin: el diálogo de proyecto ausente (Recrear / Eliminar vinculación / Ignorar) solo salía cuando el usuario lanzaba luego una sincronización a mano, de modo que una vinculación rota podía quedarse ahí sin que nadie lo notara.

El diagnóstico llevó varias rondas porque se solapaban dos efectos distintos, y un tercero enmascaraba los resultados por completo:

- **Detección.** `projectListUpdate` era la señal designada para el borrado, pero las capturas de consola mostraron que **nunca se dispara** en SP 18.16 (macOS) — ni tampoco `taskUpdate` / `anyTaskUpdate` para las tareas del proyecto eliminado. La eliminación de un proyecto llega al plugin por un único canal: el hook genérico `action`, como `[Task Shared] deleteProject`. Ese tipo no es una acción estructural de *tarea*, así que el filtro del hook lo descartaba. Corrección: `isProjectDeleteAction(type)` (el `normalizeActionType` ya existente contra un conjunto conocido propio) lo reconoce antes del filtro estructural y lo enruta a la comprobación de existencia del proyecto para todas las sesiones — deliberadamente **no** a través de `handleSpChange`, cuyo `SP_HOOK_COOLDOWN_MS` se lo tragaría.
- **Supervivencia.** Incluso cuando el diálogo sí se solicitaba, no permanecía en pantalla: la consola de SP registraba `PluginBridge: Dialog closed` sin interacción del usuario. Eliminar el proyecto *activo* hace que SP se aleje de esa vista y la desmonte, descartando cualquier modal abierto en esa ventana de agitación. Corrección: `handleMissingProject(session, proactive)` — el único punto de paso por el que discurren todos los caminos de detección — lanza ahora un `showSnack` de aviso inmediato (un snack se pinta desde el contexto de background y sobrevive a la navegación) y solo después espera `PROJECT_DELETE_SETTLE_MS` (2 s) antes de abrir el modal.
- **El factor que lo enmascaraba.** Todas las pruebas anteriores que "seguían fallando" habían ejecutado el código *antiguo*: SP instala un plugin subido **desactivado**, sigue ejecutando la instancia previamente activa y no carga en caliente el ZIP nuevo hasta que el usuario lo activa a mano. Queda recogido como particularidad de la plataforma en la Guía Técnica de Arquitectura, junto con el ritual de verificación (desinstalar → salir → reabrir → instalar → activar → confirmar la versión del pie *antes* de probar).

Verificado en vivo en SP 18.16 (macOS) con el build confirmado activo: `deleteProject` → snack ≈ 7 ms después → diálogo ≈ 2,0 s después, sin auto-cierre, sin diálogo duplicado, y las sincronizaciones de las vinculaciones supervivientes se completan dentro de la ventana de espera. `project-delete-proactive.test.ts` cubre el enrutado, el snack, la garantía de que nunca se abre de forma síncrona y el caso de renombrado que **no** debe dispararlo.

Del uso de la corrección —no de las pruebas— salió un remate: el snack de aviso seguía llevando la instrucción previa a la corrección de pulsar *Sync Now*, que el diálogo proactivo acababa de volver innecesaria, e identificaba la vinculación por la ruta absoluta del fichero, así que el mensaje era a la vez incorrecto y demasiado largo para leerse en los dos segundos que debe cubrir. Ahora dice `project "<título>" was deleted — opening options…`, nombrando el proyecto desde `projectTitle` (refrescado en cada comprobación de existencia, con el basename del fichero como respaldo para una vinculación cuyo proyecto nunca se vio). El modal posterior lleva las opciones, así que el snack no necesita llevarlas. Su tipo también se rebajó de `ERROR` a `INFO` (v0.4.6): un snack de error rojo exageraba un evento que el propio usuario acababa de provocar.

**Bug #49 — importar un `.md` con marcadores `<!--taskId-->` ajenos perdía todas las subtareas (v0.4.5)**

Encontrado por el usuario mientras probaba el Bug #48: volver a vincular tras borrar un proyecto es justo el caso que deja un fichero lleno de ids que el proyecto nuevo nunca ha visto. Vincular un fichero Markdown que aún contenía ids de tareas de otro proyecto (un fichero copiado, o uno cuyo proyecto se había recreado) a un proyecto nuevo o vacío importaba solo las tareas raíz; todas las subtareas desaparecían en silencio.

Causa raíz en `generateTaskOperations`: cuando ninguno de los ids del fichero existe en el proyecto destino, cada tarea es un **create**, y los creates se direccionan con los ids `temp_<línea>` que acuña el lote. Sin embargo, el `parentId` de una subtarea se emitía como el **id ajeno obsoleto** del padre — una referencia colgante — así que SP descartaba la subtarea mientras aceptaba las tareas raíz. Corrección: en ambos puntos de creación, si el padre resuelto no está en el mapa de tareas de SP se usa el `temp_${parentMd.line}` del padre. Se actualizaron tres specs existentes que afirmaban los ids antiguos a la forma `temp_*`, y `repoint-foreign-ids.test.ts` fija el comportamiento (4 creates, 0 deletes, subtareas enlazadas al id temporal del padre). Verificado en vivo por el usuario en la misma sesión, sobre la revinculación que lo había destapado.

**Mejora C2 — "Eliminar + limpiar archivo" en el diálogo de proyecto ausente (v0.4.5)**

Eliminar una vinculación desde el panel de configuración ofrecía *Eliminar vinculación* / *Eliminar + limpiar archivo* / *Cancelar*, pero el diálogo de proyecto ausente ofrecía solo *Eliminar vinculación* — dejando el `.md` lleno de marcadores ocultos precisamente en el caso en que el fichero sobrevive. El diálogo ofrece ahora también **Eliminar + limpiar archivo** (solo mientras el fichero existe), y ambos puntos de llamada comparten un único helper `cleanFileMarkers`. El espejo en el diálogo de *fichero* ausente no aplica: ese fichero ya no está.

**Limitación documentada — el anidamiento Markdown es de solo dos niveles**

SP admite un único nivel de subtareas, así que el plugin mapea exactamente dos niveles de Markdown. Las líneas de tarea indentadas a un tercer nivel o más no se pierden en silencio, pero degradan a notas de la subtarea de segundo nivel más cercana. Recogido en ambos READMEs en lugar de "corregido": es una propiedad del modelo de tareas de SP, no del parser.

## Resultados de verificación final (Ronda 15)

- **Tests**: 423/423 pasan en 48 suites (`npm test`).
- **TypeScript**: Sin errores (`npx tsc --noEmit`).
- **Build**: OK — `sync-md-multi-v0.4.6.zip`.
- **Manual (macOS, M2, SP 18.16)**: Bug #47 verificado en vivo en ambas direcciones (promoción y degradación, por menú y arrastrando); Bug #48 verificado desde una reinstalación limpia con el build confirmado **activo** (snack inmediato, diálogo tras la espera de asentamiento, diálogo que permanece abierto); el "Eliminar + limpiar archivo" de la Mejora C2 verificado en vivo (vinculación eliminada, marcadores retirados, tareas hijas intactas); Bug #49 verificado en vivo (un `.md` con ids ajenos revinculado a un proyecto vacío importa sus padres **y** sus subtareas).

---

*Revisión de calidad y corrección de bugs por Fernando Pindado con Claude (Anthropic) — Mayo–Septiembre 2026.*
