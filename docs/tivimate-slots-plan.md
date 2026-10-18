# Plan: publicar slots M3U para TiviMate vía gist secreto

> Documento autocontenido. Recoge toda la investigación y las decisiones de la conversación previa para poder implementar en un chat nuevo sin contexto adicional. Fecha: 2026-10-18. **Aún no se implementó nada**: solo se hizo investigación y se probó la viabilidad del gist.

## 1. Objetivo

Poder **agregar y editar fuentes (M3U y Xtream) desde IPTV Manager y que los cambios lleguen a TiviMate en todos los dispositivos sin tocarlos**, manteniendo la separación por fuente (cada una con sus grupos originales), con el máximo de automatización posible.

## 2. Restricciones del usuario

- **Sin servidor** (ni externo ni pagado) y **sin tener la PC prendida 24/7**.
- Sin API Xtream emulada (agrega latencia y requiere servidor).
- Se acepta perder VOD/series: lo importante son los **canales en vivo** y que se **actualicen automáticamente**.
- Las fuentes se agregan y editan constantemente, con dominios distintos entre sí.
- Cada fuente tiene ~2000 canales con sus propios grupos. **No se quieren ignorar ni mezclar los grupos de cada lista**, y una lista maestra de ~10k canales es inmanejable en TiviMate.
- No se quieren filtrar canales a mano salvo los caídos.
- Estilo de UI: ver memoria del proyecto (diseño oscuro ámbar, controles custom, sin bordes de acento en estados activos).

## 3. Lo que se investigó y descartó

### 3.1 Editar el backup `.tmb` de TiviMate — descartado
- Archivo de ejemplo: `TiviMate_backup_20261018_170111_v5332.tmb` (40 MB). App instalada: TiviMate 5.3.3 (versionCode 1000005332), paquete `ar.tvplayer.tv`.
- No es un ZIP (aunque algunos sitios genéricos de extensiones lo afirman, probablemente desactualizados). Está **cifrado entero**: sin cabecera reconocible, entropía 7.999994 bits/byte, tamaño múltiplo de 16 (bloques tipo AES).
- Búsquedas web: no existe ninguna herramienta pública ni documentación del formato.
- Se extrajo el APK por ADB (ADB funciona desde WSL con `/mnt/c/Users/matia/AppData/Local/Android/Sdk/platform-tools/adb.exe`; dispositivo Samsung SM-S936B). El APK está protegido con **DexProtector** (`libdexprotector.so` en las 4 ABIs y `assets/assets.dat`; en `classes.dex` no aparece lógica de backup). Descifrar el `.tmb` implicaría esquivar esa protección: mucho trabajo, frágil entre versiones y es elusión de una medida de protección técnica. **Decisión: no se hace.**
- TiviMate no tiene API, sincronización en la nube ni control remoto.

### 3.2 Alternativas descartadas por el usuario
- **API Xtream emulada** (servidor propio o externo): rechazada por latencia y costo.
- **Una lista maestra única** o por categoría: rechazada porque con 5 fuentes de ~2k canales se mezclan los grupos, no se sabe de qué fuente es cada uno y es difícil de navegar.
- **Una playlist de TiviMate por fuente con URL nueva cada vez**: obliga a tocar todos los dispositivos al agregar una fuente. Se resuelve con **slots** (sección 4).
- GitHub Actions para correr el checker: las IP de datacenter suelen ser bloqueadas por los proveedores.

## 4. Diseño elegido: slots fijos

- Se reservan **N slots (inicialmente 10)**. Cada slot es **un archivo M3U con URL fija** que contiene **una sola fuente completa**, con sus grupos y atributos originales. Solo se quitan los canales caídos según el checker.
- Una sola vez, en cada dispositivo, se agregan a TiviMate las 10 URLs como playlists (`Lista 1` … `Lista 10`). Después ya no se toca ningún dispositivo.
- Agregar una fuente = asignarla a un slot libre y publicar. Editarla = sobrescribir el mismo slot (la URL no cambia).
- Las fuentes **Xtream se convierten a M3U** (URLs `…/live/usuario/clave/<id>.ts`, estáticas mientras la cuenta esté vigente).
- **Slots llenos**: la UI debe ofrecer **reemplazar** un slot (se elige cuál; aviso de que los favoritos/grupos ocultos de TiviMate pertenecen a la fuente anterior y que el nombre de la playlist en el dispositivo no cambia). Otras opciones consideradas: subir N (las URLs nuevas hay que agregarlas a mano una vez) o un slot de desborde que junte fuentes con prefijo de grupo.
- **Trazabilidad**: cada M3U publicado lleva una línea de comentario en la cabecera (TiviMate la ignora) y la base guarda el historial de asignaciones. Ver sección 7.

### Tradeoffs aceptados
- El nombre de la playlist en TiviMate lo pone el usuario al agregar el slot; no cambia solo al reasignar. (Por testear: si TiviMate toma un nombre de la cabecera del M3U.)
- Favoritos, grupos ocultos y orden manual de TiviMate son por playlist: no reciclar slots a la ligera.
- Frescura: caché de `raw` de ~5 minutos, y la salud de los canales es tan reciente como la última corrida del checker (que corre con la PC prendida).
- Lo que se guarda solo en TiviMate (favoritos, orden manual, ajustes) sigue siendo manual.

### Riesgos al pasar Xtream → M3U
En Xtream estándar no hay refresh token; los riesgos reales son:
- El proveedor reasigna `stream_id` o categorías → la lista publicada queda desactualizada hasta el próximo sync + publicación.
- Cuenta vencida o límite de conexiones (pasa igual en Xtream, pero acá el archivo publicado queda inútil).
- Paneles con URLs firmadas/`?token=` o redirecciones con firma temporal (el redirect normal sí se sigue solo).
- `xtream-fetcher.js` fija la extensión `.ts`; hay proveedores que solo permiten `m3u8` (ver `allowed_output_formats` en `user_info`).
- Hay que incluir la URL de EPG (`xmltv.php`) en la cabecera del M3U o se pierde el EPG.

## 5. Hosting: gist secreto de GitHub (verificado)

El repo `MatiasTK/IPTV-Manager` es **público**. Versionar M3U con credenciales de proveedores ahí dejaría las credenciales indexables y en el historial para siempre, así que **no se publican en el repo**. (El archivo actual `output/playlist.m3u`, ya versionado, solo tiene 17 streams públicos sin credenciales.) TiviMate necesita una URL accesible sin autenticación, así que lo realista es una URL secreta e imposible de adivinar: un **gist secreto**.

Pruebas hechas con un gist temporal (ya borrado, contenido ficticio):

| Requisito | Resultado |
|---|---|
| Actualizar el mismo gist | Sí, `PATCH` a la API. |
| Mismo link | Sí, **si se usa la URL sin hash de revisión**: `https://gist.githubusercontent.com/<usuario>/<gist_id>/raw/<archivo>`. La `raw_url` que devuelve la API trae un hash de revisión que cambia en cada edición: **no usarla**; armar la URL estable a mano. |
| Sin límite práctico de tamaño | Archivos de 0,3 MB (2k canales), 1,5 MB (10k) y 7,8 MB (50k) se descargaron completos por `raw`. El `truncated: true` de la API afecta solo a su JSON, no al archivo servido. |
| No indexable | El gist es secreto (no listado) y la página tiene `<meta name="robots" content="noindex">`. |
| Frescura | `cache-control: max-age=300`; una edición se vio ~4:46 min después. |
| Content-Type | `text/plain; charset=utf-8` (no `audio/mpegurl`). **No probado con TiviMate.** |

Hallazgos que condicionan la implementación:
- **`gh gist create/edit` rechaza `.m3u`** (`binary file not supported`). Hay que usar la API REST directo: `gh api gists` (crear) y `gh api -X PATCH gists/<id> --input body.json` (actualizar). Un solo `PATCH` puede actualizar los 10 archivos.
- `gh` está autenticado como `MatiasTK` con scopes `gist, read:org, repo`; protocolo ssh.
- Cada edición deja una **revisión** del gist accesible con el link: credenciales viejas siguen visibles para quien tenga el link.
- "Secreto" = no listado, no privado. Si el link se filtra, la única salida es **rotar** (gist nuevo → URLs nuevas → re-agregarlas en TiviMate). Por eso conviene una acción "Rotar" en la UI.

## 6. Estado actual del backend (revisado, sin cambios)

Node/Express + better-sqlite3 + frontend React/Vite/TypeScript en `frontend/`. Rutas montadas en `src/server.js` bajo `/api/*` (auth, channels, groups, sources, settings, health, raw, checker) y `/playlist` (público con token).

- `src/db/database.js`: esquema con `sources` (`id, name, url, type` = `url`/`text`/`xtream`, `auto_sync`, `sync_interval_hours`, `channel_count`, `priority`, `auto_priority`, `xtream_host/user/pass`), `channels` (`source_id`, `group_id`, `is_active`, `health_status` = healthy/degraded/unknown/down, `tvg_*`, `catchup*`, `http_user_agent`, `referrer`…), `groups` (**globales, nombre único**), `channel_alternatives`, `health_checks`, `settings` (clave/valor; incluye `playlist_token`, `playlist_name`, `epg_urls`).
- `src/services/m3u-generator.js`: genera **un único M3U global** mezclando fuentes y agrupando duplicados entre fuentes como alternativas con `tvg-id` compartido. No sirve tal cual para slots por fuente.
- `src/routes/playlist.js`: sirve `/playlist/:token/playlist.m3u`.
- `src/services/xtream-fetcher.js`: obtiene `player_api.php` (info, categorías, `get_live_streams`) y construye `…/live/<user>/<pass>/<stream_id>.ts`; devuelve también `epgUrl`.
- `src/routes/sources.js`: import M3U/Xtream/texto, sync por fuente (`POST /:id/sync`) y `importChannels()`.
- **Atención**: `importChannels` busca por **URL exacta global**; si dos fuentes comparten una URL, el canal queda asociado a la primera fuente (el update no reasigna `source_id`). Un export por fuente podría omitirlo en la segunda.
- No existe el concepto de slot ni de publicación.
- Frontend: `frontend/src/pages/*.tsx` (channels, checker, duplicates, groups, health, raw-editor, settings, sources, login), `components/{channels,checker,layout,shared,sources,ui}`, `lib/api.ts`.
- `setting`s editables vía `PUT /api/settings` con lista blanca de claves.
- Hay trabajo sin commitear en el repo (rama `feat/redesign-sala-de-control`); revisar `git status` antes de empezar.

## 7. Plan de implementación

### 7.1 Base de datos (`src/db/database.js`, migración idempotente)
- `publish_slots`: `slot` (PK, 1..N), `source_id` (nullable), `assigned_at`, `content_hash`, `published_at`, `channel_count`, `dead_excluded`, `last_error`.
- `publish_slot_history`: `slot`, `source_id`, `source_name`, `assigned_at`, `released_at`.
- Settings nuevas: `publish_gist_id`, `publish_slot_count` (10), `publish_auto` (0/1). **No se guarda token de GitHub**: se usa el de `gh`.
- Sembrar los N slots vacíos al arrancar.

### 7.2 Generador por fuente (`src/services/slot-generator.js`)
- `generateSourceM3U(sourceId, slot)`: canales activos de la fuente, ordenados por grupo y `sort_order`, con los mismos atributos que emite hoy `m3u-generator.js` (`tvg-*`, `group-title`, `catchup*`, `http-user-agent`, `#EXTVLCOPT`).
- Sin lógica de alternativas entre fuentes. Excluye `health_status = 'down'`.
- Cabecera `#EXTM3U` con `x-tvg-url` de los EPG de esa fuente (hoy `epg_urls` es global; decidir si se guarda uno por fuente).
- Línea de trazabilidad, **sin credenciales**: `# iptv-manager slot=03 source_id=12 source="Nombre" type=xtream published=<ISO> channels=1873 dead_excluded=41`.
- Slot vacío: M3U mínimo con un canal marcador (verificar cómo lo trata TiviMate).

### 7.3 Publicador (`src/services/gist-publisher.js`)
- Invoca `gh api` con `child_process`. El servidor necesita `gh` autenticado en el PATH (alternativa: guardar un token en settings, con el costo de guardar un secreto).
- Primera vez: crea el gist secreto (`public: false`) con los N archivos `slot-01.m3u` … y guarda `publish_gist_id`.
- Luego: un solo `PATCH` con los archivos cuyo `content_hash` cambió.
- Expone la URL estable sin hash de revisión.
- Errores por slot en `last_error`, sin romper el resto; reintento manual.

### 7.4 API (`src/routes/publish.js`, `/api/publish`, con auth y csrf como el resto)
- `GET /slots`, `PUT /slots/:n` (asignar/reemplazar/liberar; registra historial), `POST /publish`, `POST /publish/:n`, `POST /rotate`, `GET /preview/:n` (diff contra lo publicado).
- Hooks: tras un sync de fuente o al terminar el checker, si `publish_auto = 1`, republicar los slots afectados.

### 7.5 Frontend (`frontend/src/pages/publish.tsx` + entrada en la barra lateral)
- Tabla de slots: nº, fuente, tipo, URL con botón copiar, canales, caídos excluidos, última publicación, estado.
- Acciones: asignar/reemplazar/liberar (con el flujo de reemplazo si están llenos), publicar, vista previa, rotar gist, interruptor de publicación automática.
- Avisos por fuente: Xtream por vencer o sin formatos permitidos, alto porcentaje de canales caídos.

### 7.6 Validaciones previas a publicar
- Xtream: `user_info` (estado, vencimiento, conexiones) y `allowed_output_formats`; usar `m3u8` si `ts` no está permitido; incluir `xmltv.php` como EPG.
- Decidir qué hacer con URLs repetidas entre fuentes (ver sección 6).

### 7.7 Orden de trabajo sugerido
1. Migración y tablas.
2. Generador por fuente; comparar con el M3U actual sobre fuentes reales.
3. Publicador de gist + **un slot de prueba cargado en TiviMate** (valida `text/plain`, tamaño, slot vacío y nombre de la playlist; es la mayor incógnita).
4. API de slots y publicación.
5. Página de Publicación.
6. Publicación automática, validaciones Xtream y rotación.

## 8. Riesgos y preguntas abiertas
- Comportamiento real de TiviMate con `text/plain`, con un slot vacío, y si toma el nombre de la playlist de la cabecera: **no probado**.
- Dependencia de `gh` autenticado en el entorno donde corre el servidor.
- Link filtrado → rotar y re-agregar en todos los dispositivos.
- Revisiones antiguas del gist conservan credenciales viejas visibles con el link.
- EPG hoy global (`epg_urls`); ¿por fuente?
- Qué hacer con canales cuya URL ya existe en otra fuente (`importChannels`).
- Qué porcentaje de canales caídos dispara el aviso.
