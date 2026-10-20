# sync.md Multi Plugin para Super Productivity

[English](README.md) · **Español**

`sync.md Multi` es una versión mejorada del plugin original `sync.md` que permite sincronizar múltiples proyectos de Super Productivity con sus propios archivos Markdown de forma simultánea e independiente.

## Contenido

- [¿Qué hace sync.md Multi?](#qué-hace-syncmd-multi)
- [Formato del archivo Markdown](#formato-del-archivo-markdown)
- [Cómo funciona la sincronización](#cómo-funciona-la-sincronización)
- [Cuando falta un archivo o proyecto](#cuando-falta-un-archivo-o-proyecto)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Actualización del plugin](#actualización-del-plugin)
- [Consideraciones importantes](#consideraciones-importantes)
- [Solución de problemas](#solución-de-problemas)
- [Para desarrolladores](#para-desarrolladores)
- [Contribuciones](#contribuciones)
- [Agradecimientos](#agradecimientos)

## ¿Qué hace `sync.md Multi`?

- **Múltiples vinculaciones de proyecto**: Asocia cualquier número de proyectos de Super Productivity con sus propios archivos `.md`, gestionados de forma completamente independiente.
- **Sincronización bidireccional**: Los cambios realizados en Super Productivity se escriben al archivo Markdown; los cambios en el archivo Markdown se importan de vuelta a Super Productivity.
- **IDs de tarea preservados en Markdown**: Cada tarea se identifica con un ID único incrustado como comentario HTML (`<!--task-id-->`), lo que permite una sincronización fiable sin pérdida de datos.
- **Soporte de notas**: Las notas de las tareas se sincronizan junto con los títulos y el estado de completado.
- **Preservación de cabeceras**: Cualquier front matter YAML o texto libre al inicio del archivo `.md` (antes de la primera línea de tarea) se conserva cuando el plugin reescribe el archivo.
- **Prevención de oscilación**: Tras una sync Markdown→SP, el plugin suprime write-backs redundantes de SP→Markdown durante 2 segundos, evitando bucles de sincronización.
- **Consciencia del foco de ventana**: La sync desencadenada por cambios en el archivo se ejecuta inmediatamente cuando Super Productivity tiene el foco; en caso contrario se difiere hasta que la ventana recupere el foco.
- **Conversión padre–hijo de tareas (en ambos sentidos)**: Cambia la indentación de una subtarea en el archivo Markdown para ascenderla a tarea padre, o indenta una tarea padre bajo otra para convertirla en subtarea — el cambio se recoge en la siguiente sync. El sentido inverso también funciona: ascender o degradar una tarea **en la propia Super Productivity** (por su menú o arrastrando) se escribe de vuelta al archivo `.md`.
- **Coexistencia**: `sync.md Multi` tiene un ID de plugin diferente (`sync-md-multi`) y puede instalarse junto al plugin original `sync.md` sin conflictos.

## Formato del archivo Markdown

El plugin utiliza un formato Markdown específico. Las tareas se representan como casillas de verificación con un comentario HTML incrustado que contiene el ID de la tarea en SP:

```markdown
- [ ] <!--task-id-abc123--> Título de la Tarea Padre
  - [x] <!--task-id-def456--> Subtarea Completada
    Una nota de la subtarea
  - [ ] <!--task-id-ghi789--> Subtarea Pendiente
  Una nota de la tarea padre
```

Convenciones clave:
- Las tareas padre no tienen indentación; las subtareas se indentan con 2 espacios.
- El comentario `<!--id-->` va después de la casilla y antes del título.
- Las notas aparecen como líneas de texto debajo de su tarea, indentadas 4 espacios (notas de subtarea) o 2 espacios (notas de padre).
- La nota de una tarea es el texto de las líneas justo debajo de ella, hasta la primera línea en blanco. Una línea en blanco **termina la nota** — lo que venga después de un blanco queda en el archivo tal cual, pero no se asocia a la tarea. (Esto es coherente con el borrado: al eliminar una tarea solo se limpian sus líneas de nota hasta la primera línea en blanco. Ten en cuenta el compromiso: una nota partida en párrafos por una línea en blanco solo conserva su primer párrafo en Super Productivity.)
- Las tareas añadidas manualmente sin comentario de ID recibirán uno en la siguiente sync.
- El plugin preserva cualquier contenido que aparezca antes de la primera línea de tarea (cabeceras, front matter YAML, etc.).

### Profundidad de anidamiento: solo dos niveles

El modelo de tareas de Super Productivity tiene exactamente **dos niveles** — una tarea padre y sus subtareas. El plugin sigue ese modelo, así que solo los dos primeros niveles de indentación del archivo Markdown se tratan como tareas:

- **Sin indentación** → tarea padre (raíz).
- **Un nivel de indentación** → subtarea.
- **Dos o más niveles de indentación** → **no** se importan como tareas. Cualquier línea más profunda se pliega dentro de las **notas** de la subtarea de nivel 2 más cercana.

```markdown
- [ ] Nivel 1            → tarea raíz
    - [ ] Nivel 2        → subtarea
        - [ ] Nivel 3    → pasa a ser una NOTA de "Nivel 2" (no una tarea)
            - [ ] Nivel 4 → también una NOTA de "Nivel 2"
```

El texto más profundo se conserva (como contenido de nota, dejando el literal `- [ ]` intacto), pero **pierde su naturaleza de tarea**: su casilla no se sincroniza, no se puede completar desde SP y no cuenta como subtarea. Crear un binding sobre un archivo con más de dos niveles no falla — los niveles más profundos simplemente se degradan a notas, y no se garantiza que su ida y vuelta sea sin pérdidas. **Mantén los archivos en dos niveles para fidelidad total.** Si necesitas más estructura visual en profundidad, escríbela como texto plano indentado dentro de una nota (sin casilla `- [ ]`) para que viaje limpiamente como nota en lugar de confundirse con una tarea.

### Títulos de sección y otro contenido no-tarea dentro del área de tareas

Las líneas tipo `## Tareas completadas` que aparecen entre líneas de tarea se tratan como **delimitadores de sección** durante la importación Markdown→SP: no se importan a SP como tareas ni se añaden a las notas de ninguna tarea. Durante el write-back SP→Markdown, el plugin realiza una **actualización en sitio** — solo se modifican las líneas de casilla de verificación, y el resto de líneas (títulos de sección, líneas en blanco, notas, texto libre) **se preservan exactamente tal cual están escritas**.

### Marcas de tiempo de completado (`@done`)

Cuando completas una tarea en Super Productivity, el plugin añade una etiqueta `@done` con la hora local de completado a la línea de esa tarea en el archivo Markdown:

```markdown
- [x] <!--task-id-def456--> Subtarea Completada @done(2026-07-07 14:30)
```

- El formato es `@done(YYYY-MM-DD HH:mm)` en tu hora local.
- Reabrir la tarea (marcarla de nuevo como no completada) elimina la etiqueta `@done`. Las tareas activas se quedan sin etiqueta.
- La escritura es **idempotente**: volver a sincronizar una tarea ya completada no reescribe la marca de tiempo.
- Al leer un archivo, el plugin mantiene limpio el título de la tarea en SP — reconoce un `@done` al final, `@done(2026-07-07)` (solo fecha) o `@done(2026-07-07 14:30)` y lo elimina del título importado.
- Una fecha que hayas escrito tú mismo en el archivo se **conserva** en las idas y vueltas (el plugin no sobrescribe una marca de tiempo ya existente).

> **Nota**: Las etiquetas `@todo` y `@doing` **no** las escribe el plugin (Super Productivity solo distingue entre completado y no completado). Si ya aparecen en un archivo, se toleran (se mantienen fuera del título en SP) pero el plugin no las gestiona.

Esto alinea el formato del archivo Markdown con la aplicación complementaria **Taskdown**.

## Cómo funciona la sincronización

La sincronización es **bidireccional y automática** en ambos sentidos:

- **Editas el archivo Markdown** → los cambios se importan a Super Productivity (tareas creadas, actualizadas, completadas, eliminadas o reordenadas para coincidir con el archivo).
- **Cambias algo en Super Productivity** (editar una tarea, completarla, moverla entre proyectos…) → el cambio se escribe de vuelta al archivo Markdown.

Al escribir de vuelta al archivo, el plugin realiza una **fusión en sitio**: solo toca las líneas de casilla de verificación. El resto de líneas — títulos de sección, líneas en blanco, notas, texto libre — se conservan exactamente como las escribiste. Las tareas eliminadas en SP se borran; las tareas nuevas en SP se añaden al final. Si el archivo aún no existe, se crea desde cero.

Para evitar bucles de sincronización, un write-back desencadenado justo después de una importación archivo→SP se suprime brevemente. Los cambios en el archivo se recogen de inmediato cuando Super Productivity tiene el foco, y se difieren hasta que lo recupere en caso contrario.

**Sync manual** — el botón *Sync Now* en la cabecera de SP fuerza una pasada bidireccional inmediata. Cualquier edición que hayas hecho en un archivo desde su último sync se importa a Super Productivity **primero** — para que un cambio que acabas de hacer nunca se sobrescriba — y después se escribe el estado actual de SP de vuelta a cada archivo.

**Sync inicial** (al crear una vinculación o al arrancar el plugin):
- Si el archivo `.md` no existe, tus tareas de SP se escriben en él (creando el archivo).
- Si el archivo `.md` ya existe, sus tareas se importan a SP y los IDs de tarea se estampan en el archivo de inmediato — sin necesidad de reiniciar.

## Cuando falta un archivo o proyecto

Una vinculación nunca debe seguir funcionando en un estado defectuoso. Si una sync detecta que falta un recurso del que depende, el plugin se detiene y muestra un diálogo preguntándote cómo proceder. Hay dos casos.

**Falta el archivo Markdown** (eliminado, movido, o en una carpeta/volumen que no está disponible en ese momento):

- **Recreate from SP** — regenera el archivo `.md` a partir de las tareas actuales del proyecto vinculado.
- **Delete binding** — elimina la vinculación.
- **Ignore** — descarta el diálogo. Si restauras el archivo tú mismo, la siguiente sync continúa con normalidad. Si sigue faltando, el diálogo reaparece en la siguiente sync.

> **Nota**: Crear una vinculación nueva que apunte a un archivo que aún no existe sigue creando ese archivo de forma silenciosa, sin diálogo. El diálogo solo aparece para un archivo que existía antes y luego desapareció.

**Se eliminó el proyecto de Super Productivity vinculado** (tu archivo `.md` se deja intacto):

- **Recreate project in SP** — crea un nuevo proyecto con su nombre anterior, revincula la vinculación a él y reimporta las tareas desde el archivo `.md`.
- **Delete binding** — elimina la vinculación (el archivo `.md` se queda donde está).
- **Ignore** — descarta el diálogo. Úsalo si tienes previsto crear un proyecto y revincular tú mismo desde el panel de configuración. El diálogo reaparece en la siguiente sync si el proyecto sigue faltando.

Si faltan **tanto** el proyecto **como** el archivo `.md`, solo se ofrecen **Delete binding** e **Ignore**.

> Eliminar un proyecto nunca borra tu archivo `.md`. Tu contenido Markdown siempre se conserva.

## Instalación

**Para usuarios (recomendado)** — instala un ZIP pre-compilado:

1. Descarga el `sync-md-multi-v<versión>.zip` más reciente desde la [página de releases de Codeberg](https://codeberg.org/fpindado/sync-md-multi/releases).
2. **Abre Super Productivity** y ve a `Ajustes → Plugins`.
3. Haz clic en `Install Plugin from ZIP`, selecciona el zip descargado y confirma.
4. `sync.md Multi` aparecerá en tu lista de plugins, listo para configurar.

**Para desarrolladores** — compílalo tú mismo:

1. Compila el plugin:
   ```sh
   npm install
   npm run build
   ```
   Esto genera `dist/plugin.js` y un `sync-md-multi-v<versión>.zip` en la raíz del proyecto.
2. Instala el ZIP generado desde `Ajustes → Plugins → Install Plugin from ZIP` (igual que arriba).

> **Solo versión de escritorio**: Las operaciones de lectura/escritura de archivos requieren la versión de escritorio de Super Productivity. El plugin no funcionará en las versiones web o móvil.

> ⚠️ **Compatibilidad de versión SP**: Funciona plenamente en Super Productivity **≤ 18.9.1** y **≥ 18.13.1** (verificado en macOS, Apple Silicon). El rango **18.10.0–18.12.x** bloquea el acceso a archivos para plugins cargados externamente (*"Node.js execution is currently only available to built-in desktop plugins"*), por lo que el plugin no puede sincronizar ahí — **evita ese rango**. Desde **18.13.1** el acceso a archivos se reactiva tras un diálogo de consentimiento único: la primera vez que el plugin lo necesita, pulsa **Allow** (la elección se recuerda por plugin).
>
> El `minSupVersion` del manifest (10.0.0) es la versión mínima de la **API de plugins**, no el umbral de acceso a archivos: sincronizar requiere además el soporte de acceso a archivos descrito arriba (SP ≤ 18.9.1 o ≥ 18.13.1).

## Configuración

1. Abre la configuración del plugin desde la entrada **sync.md Multi** en el menú lateral izquierdo de SP (o desde el icono de engranaje en la lista de plugins).
2. En **Add New Binding**:
   - Selecciona el proyecto de Super Productivity en el desplegable.
   - Introduce la ruta absoluta al archivo `.md` (p. ej., `/home/usuario/proyectos/tareas-trabajo.md`), o haz clic en **Browse…** para navegar por el sistema de archivos. El archivo se creará si no existe.
   - Haz clic en **Add Binding**.
3. La vinculación aparece en **Active Bindings** y la sync comienza de inmediato — sin necesidad de reiniciar.

Puedes añadir tantas vinculaciones como proyectos tengas. Cada vinculación es independiente: un error en una no afecta a las demás. Cada entrada en **Active Bindings** muestra además cuándo se sincronizó por última vez.

**Importante**: Cada ruta de archivo `.md` debe ser única entre todas las vinculaciones. La interfaz rechazará una ruta duplicada para evitar que dos watchers compitan por el mismo archivo.

Para modificar una vinculación, haz clic en **Edit**. Para eliminarla, haz clic en **Delete** — un diálogo de confirmación ofrece entonces tres opciones:

- **Delete binding** — elimina la vinculación y deja el archivo `.md` intacto (sus marcas de sync ocultas `<!--…-->` se mantienen).
- **Delete + clean file** — elimina la vinculación **y** quita las marcas de sync ocultas `<!--…-->` del archivo, dejándolo neutro (desvinculado). Úsalo si quieres pasar el archivo a otra herramienta o revincularlo limpiamente más adelante.
- **Cancel** — mantiene la vinculación.

Ninguna de las dos opciones de borrado elimina el archivo `.md` en sí — solo la vinculación (y, en el caso de **Delete + clean file**, las marcas de sync que contiene).

El botón **Sync Now** en la barra de cabecera de SP (etiquetado "sync.md Multi: Sync Now") fuerza una sync **bidireccional** inmediata para todas las vinculaciones activas. La dirección se elige por fichero: si el fichero cambió desde su último sync, se importa a SP **primero** (para que tu edición manual nunca se sobrescriba) y después se escribe el estado actual de SP de vuelta; en caso contrario se ejecuta primero SP→Markdown. En cualquier caso, ambas direcciones se ejecutan.

## Actualización del plugin

El plugin comprueba si hay una release más nueva disponible cada vez que arranca Super Productivity, y luego una vez al día mientras siga abierto. Si la hay, te avisa: una notificación al arrancar Super Productivity, un botón **upgrade** en la cabecera (púlsalo para abrir la página de la release) y un marcador de "actualización disponible" en el pie del panel de configuración. Instalar la actualización es siempre manual — SP no permite que un plugin se reinstale a sí mismo — así que cuando veas el aviso, descarga el nuevo ZIP desde la [página de releases de Codeberg](https://codeberg.org/fpindado/sync-md-multi/releases) e instálalo como se indica debajo.

Tienes dos opciones:

- **Actualización rápida**: instala el nuevo ZIP directamente desde `Ajustes → Plugins → Install Plugin from ZIP` sin desinstalar primero. SP sobreescribirá los ficheros del plugin en su lugar.
- **Actualización limpia**: desinstala la versión actual primero y luego instala el nuevo ZIP.

En ambos casos, la configuración de las vinculaciones se almacena **localmente en este dispositivo** (en el almacenamiento local propio del plugin, no sincronizado entre dispositivos) y se preserva entre actualizaciones. Como la ruta del archivo de una vinculación es una ruta absoluta específica de este equipo, la configuración deliberadamente no se sincroniza entre dispositivos.

## Consideraciones importantes

- **Solo versión de escritorio**: Las operaciones de archivo no están disponibles en las versiones web o móvil de Super Productivity.
- **Editar el archivo con SP abierto**: Cuando editas un archivo `.md` vinculado, el plugin detecta el cambio (el file watcher sondea la marca de tiempo de modificación del archivo) y lo importa a SP antes de escribir de vuelta el estado de SP, de modo que una edición del archivo no queda sobrescrita por un cambio no relacionado en SP. Cuando se ejecuta una sync, la dirección se decide a partir de un **fingerprint de contenido** del archivo (no de su marca de tiempo), de modo que una edición reciente se importa antes de que cualquier write-back pueda sobrescribirla. Normalmente no necesitas pausar SP antes de editar. El file watcher sondea cada pocos segundos, así que si editas *la misma línea de tarea* en ambos lados dentro de esa breve ventana, gana la última edición que el plugin ve — para pasar el testigo entre ambos, guarda el archivo (o pulsa **Sync Now**) antes de hacer el cambio equivalente en el otro lado.
- **Mover tareas entre proyectos**: Los movimientos de tareas se detectan automáticamente. Cuando se mueve una tarea, tanto el fichero origen (tarea eliminada) como el fichero destino (tarea añadida) se actualizan dentro del tiempo de debounce normal de sync.
- **Orden a nivel raíz tras una promoción**: Cuando asciendes una tarea a nivel raíz en Super Productivity, su línea puede reubicarse al final del bloque de tareas en el `.md` en el siguiente write-back en lugar de mantenerse en su sitio. El contenido es correcto y estable tras esa sync; solo su posición puede cambiar.
- **IDs únicos en comentarios**: No elimines ni alteres los comentarios `<!--id-->` de tu archivo Markdown. Son el vínculo entre una línea y su tarea en SP. Una línea sin comentario de ID se tratará como una tarea nueva en la siguiente sync.
- **Los títulos de sección y las líneas no-tarea se preservan**: Los encabezados Markdown (`##`, `###`, etc.) y el resto de líneas no-tarea dentro del área de tareas se conservan exactamente tal cual durante un write-back SP→Markdown. No se importan a SP (SP no tiene concepto de secciones), pero sobreviven a los write-backs intactos.
- **Las notas del archivo son la fuente de verdad**: Las notas de las tareas en el archivo Markdown se preservan verbatim durante el write-back SP→Markdown. Si editas las notas de una tarea dentro de Super Productivity, esos cambios **no se escriben** de vuelta al archivo Markdown — las líneas de nota del archivo se mantienen tal cual. Las notas escritas en el archivo Markdown sí se importan a SP en la siguiente sync Markdown→SP.
- **Migración de configuración**: Si utilizabas el plugin original `sync.md`, su configuración de proyecto único (`filePath` + `projectId`) se migra automáticamente a una vinculación V2 en la primera carga.

### Qué ocurre con las tareas existentes en SP al crear una vinculación

El comportamiento en la primera sync depende de si el archivo `.md` ya existe o no:

| Situación | Qué ocurre |
|---|---|
| **El archivo no existe** | Las tareas de SP se escriben al nuevo archivo. SP no cambia. |
| **El archivo existe pero no tiene líneas de tarea** | Se trata igual que si no existiera: las tareas de SP se escriben en él. SP no cambia. |
| **El archivo existe y tiene tareas** | **El archivo es la fuente de verdad.** Las tareas del archivo se importan a SP (se crean o se emparejan por título). Las tareas que existen en SP pero no aparecen en el archivo son **eliminadas de SP**. |

> ⚠️ **Advertencia**: Si vinculas un archivo que no contiene tus tareas existentes de SP, esas tareas serán eliminadas del proyecto. Para conservar las tareas existentes de SP, vincula un archivo que aún no exista (SP las escribe al archivo) o asegúrate de que el archivo ya contiene esas tareas antes de crear la vinculación.

## Solución de problemas

**El plugin no puede sincronizar en SP 18.10.0–18.12.x**
Esas versiones bloquean el acceso a archivos para plugins cargados externamente. Actualiza a **SP ≥ 18.13.1** — lo reactiva tras un diálogo de consentimiento único (pulsa **Allow**) — o quédate en **≤ 18.9.1**.

**El plugin no aparece o no funciona**
Asegúrate de usar la versión de escritorio de Super Productivity y de que soporte la versión de la API de plugins que requiere este plugin. Intenta reinstalarlo desde el ZIP.

**El desplegable de proyectos muestra solo "Inbox" o falta un proyecto recién creado**
El plugin carga la lista de proyectos directamente desde Super Productivity cada vez que abres el panel, con reintentos automáticos cada 2 segundos. Si solo aparece "Inbox", SP puede que no haya terminado de cargar el estado de proyectos en el contexto del iframe — espera un momento y el desplegable se actualizará solo. También puedes pulsar el botón **↺** junto al desplegable para forzar una actualización inmediata. Un proyecto recién creado debería aparecer en pocos segundos; si no aparece, pulsa ↺.

**La sync no se activa después de editar el archivo**
Verifica que la ruta del archivo en la vinculación sea correcta y que la aplicación tenga permisos de lectura/escritura en esa ubicación. El file watcher sondea la marca de tiempo de modificación (`mtime`) del archivo para detectar un cambio; la dirección de la sync se decide después a partir de un fingerprint de contenido (ver *Consideraciones importantes*). Algunos editores escriben en un archivo temporal y renombran — esto debería seguir detectándose, pero el botón **Sync Now** en la cabecera de SP puede forzar una actualización.

**Las tareas aparecen duplicadas tras una sync**
Normalmente significa que los comentarios `<!--id-->` fueron eliminados o corrompidos. Recupéralos desde una copia de seguridad, o bien elimina las tareas afectadas en SP y deja que la siguiente sync SP→Markdown regenere el archivo limpiamente.

**Errores en la consola**
Abre la consola de desarrollador (`Ctrl+Shift+I` / `Cmd+Opción+I`) y busca mensajes con el prefijo `[sync-md]`. Los errores incluyen la ruta del archivo de la vinculación para facilitar la identificación.

**La sync SP→Markdown se ejecuta pero no produce cambios visibles**
El cooldown de 2 segundos tras una sync Markdown→SP puede estar suprimiendo el write-back. Esto es intencionado — espera unos segundos y provoca una actualización de tarea en SP para forzar una nueva sync SP→Markdown.

## Para desarrolladores

```sh
npm install          # Instalar dependencias
npm run build        # Empaquetar el plugin + crear el ZIP de distribución
npm test             # Ejecutar la suite de tests
npx tsc --noEmit     # Verificación de tipos TypeScript
```

Los detalles de arquitectura e implementación están documentados en `Tech_Docs/`.

## Contribuciones

Si encuentras un bug o quieres proponer una funcionalidad, abre un issue. Los pull requests son bienvenidos.

## Agradecimientos

`sync.md Multi` está basado en el plugin original [`sync.md`](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/sync-md), creado por **Johannes Millan** ([@johannesjo](https://github.com/johannesjo)), autor de [Super Productivity](https://github.com/johannesjo/super-productivity). Muchas gracias por la excelente base que ha hecho posible esta extensión.

La evolución multi-proyecto la desarrolló Fernando Pindado junto con Claude (Anthropic).

---

Basado en [`sync.md`](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/sync-md) por [@johannesjo](https://github.com/johannesjo) · Extensión multi-proyecto por Fernando Pindado con Claude (Anthropic)
