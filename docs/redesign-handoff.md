# Rediseño del frontend — handoff de implementación

Implementar en `frontend/src` el rediseño "Sala de control" aprobado en Claude Design.

- **Canvas del diseño:** https://claude.ai/artifact/UfntTNnVq2MZshuPwnNzd8 (página **Prototipo**; ignorar la página "Exploraciones")
- Leer las pantallas con la herramienta `Artifact` → `action: "read"`, `url` de arriba, `paths: ["project/<archivo>"]`. Cada archivo `.dc.html` tiene el markup completo con estilos inline y un bloque `<script>` con los datos de ejemplo y la interacción.

| Pantalla del diseño | Archivo en el canvas | Página actual |
|---|---|---|
| Menú lateral (componente) | `project/Sidebar.dc.html` | `components/layout/sidebar.tsx` |
| Login | `project/Login.dc.html` | `pages/login.tsx` |
| Canales | `project/Main.dc.html` | `pages/channels.tsx` |
| Grupos | `project/Grupos.dc.html` | `pages/groups.tsx` |
| Fuentes M3U | `project/Fuentes.dc.html` | `pages/sources.tsx` (+ `components/sources/ImportPreviewDialog.tsx`) |
| Health Status | `project/Health.dc.html` | `pages/health.tsx` |
| Duplicados | `project/Duplicados.dc.html` | `pages/duplicates.tsx` |
| Editor Raw | `project/Raw.dc.html` | `pages/raw-editor.tsx` |
| IPTV Checker | `project/Checker.dc.html` | `pages/checker.tsx` |
| Configuración | `project/Ajustes.dc.html` | `pages/settings.tsx` |

## Stack (no cambiar)

React 19 + Vite + Tailwind v4 (`@theme inline` en `src/index.css`) + shadcn/ui sobre `radix-ui` + react-router + TanStack Query + lucide-react + sonner. El build sale a `../public` (`npm run build` dentro de `frontend/`).

## Design tokens

Reemplazar las variables de `src/index.css` (hoy violeta) por estas:

| Token | Valor | Uso |
|---|---|---|
| background | `#0E1012` | fondo de página, inputs |
| card / sidebar | `#121518` | paneles, tablas, menú |
| raised | `#161A1E` | botones secundarios, popovers |
| hover / activo | `#1F2429` (menú), `#262B31` (tabs/filtros) | estado activo, solo fondo |
| border | `#22272D` (paneles), `#2A3038` (controles), `#3A414A` (control activo/casilla vacía) | |
| foreground | `#E7E9EC` | texto principal |
| muted | `#A9B0B8` (secundario), `#8A929B` (labels), `#6E767F` (títulos de sección del menú) | |
| primary (accent) | `#F2A33A`, texto encima `#0E1012`; hover de links `#FFC46B` | |
| destructive | `#FF7A6B`, borde `#5A2A2A` | |
| healthy | `#5AD1A0` | |
| degraded (lento) | `#F2C14E` | |
| intermittent | `#B79CFF` | |
| down (caído) | `#FF7A6B` | |
| unknown | `#8A929B` | |
| radius | 8px controles, 10px paneles, 12px diálogos | |

Tipografía: **Archivo** (400–700) para la UI y **JetBrains Mono** (400–500) para números, URLs, tvg-id, latencias y las "líneas de estado" en mayúsculas. Cargar desde Google Fonts en `index.html`.

## Patrones reutilizables (crear como componentes)

- **PageHeader**: línea de estado mono 12px en accent (`● ÚLTIMO CHEQUEO HACE 4 MIN`), H1 34px/700, subtítulo opcional 14px muted y acciones a la derecha (secundaria + primaria).
- **StatStrip**: grilla de stats separadas por 1px (`gap:1px` sobre fondo border), cada una con un label en mayúsculas, el valor mono 28–30px en el color del estado y una barra de 3–4px.
- **StatusLabel**: punto de 8px + texto mono 12px en mayúsculas, ambos del color del estado (ONLINE / LENTO / INTERMITENTE / CAÍDO / SIN DATO).
- **LatencyBar**: barra de 72×6px con relleno proporcional (`min(100, ms/20)%`, mínimo 6%; caído = 100% en rojo; sin dato = 0) del color del estado, más el valor mono a la derecha. Va en Canales, Health y Checker.
- **FilterChips**: botones de 44px con el contador en mono. El activo lleva fondo `#262B31` y borde `#3A414A`.
- **SegmentedTabs**: contenedor `#0E1012` con borde. La pestaña activa lleva fondo `#262B31`, sin subrayado.
- **Diálogos**: overlay `rgba(5,6,8,.72)`, panel `#121518`, borde `#2A3038`, radio 12px.

## Reglas del usuario (obligatorias)

1. **Nada de controles HTML nativos recoloreados.** Slider, checkbox, radio, select y switch tienen que ser componentes propios, estilados como en el diseño: track + relleno ámbar + perilla clara; casilla con fondo ámbar y tilde oscuro; radio con relleno ámbar y punto oscuro; lista desplegable oscura con tilde ámbar. Se pueden armar sobre las primitivas de Radix (shadcn) pero reestilando todo. Nunca usar `accent-color` ni la apariencia nativa.
2. **Sin bordes, anillos ni barras de color accent para marcar el estado activo** (ni el ítem activo del menú, ni tabs, filtros o tarjetas). Lo activo se marca solo con un fondo más claro. El accent se usa como relleno sólido (botón primario, casilla marcada) o en el ícono del ítem activo del menú.
3. Botones: el primario es relleno ámbar con texto `#0E1012` y peso 700; el secundario `#161A1E` con borde `#2A3038`; el destructivo transparente con borde `#5A2A2A` y texto `#FF7A6B`. No hay botones con borde ámbar.
4. Áreas táctiles de 44px como mínimo en los controles principales; elementos semánticos (`button`, `a`, `label`), `aria-label` en los botones de solo ícono.

## Alcance

- **Solo frontend.** No tocar `src/` del backend ni la API. Usar los hooks existentes (`hooks/use-*.ts`) y `lib/api.ts` para traer datos reales: los números y canales del diseño son de ejemplo.
- Si el diseño muestra algo que la API no provee (por ejemplo los contadores del menú, la barra de salud por grupo, la latencia de las últimas 24 h, los checks "Recientes" del Checker o "Sincronizar todas"), derivarlo en el cliente si se puede con los datos existentes. Si no se puede, dejarlo afuera y listarlo al final; **no inventar endpoints sin preguntar**.
- Mantener toda la funcionalidad actual de cada página (dialogs de alternativas, import preview, confirmaciones, etc.) re-estilada con el nuevo sistema.
- Layout responsive: el menú lateral pasa a Sheet en mobile (como hoy) y las tablas anchas scrollean horizontalmente.

## Orden sugerido

1. Tokens en `index.css` + fuentes + componentes base de `components/ui` re-estilados (button, input, checkbox, radio-group, select, slider, switch, tabs, dialog, table, badge).
2. Patrones compartidos (PageHeader, StatStrip, StatusLabel, LatencyBar, FilterChips) en `components/shared`.
3. Sidebar + AppLayout, después Login.
4. Páginas, una por una: Canales → Health → Fuentes → Grupos → Duplicados → Checker → Raw → Configuración.
5. Al terminar cada paso: `cd frontend && npm run lint && npm run build`.

## Entrega

- Trabajar en una rama nueva (`feat/redesign-sala-de-control`) y hacer commits por paso. No hacer push ni abrir un PR sin pedirlo.
- Al final, levantar el backend (`npm run dev` en la raíz, puerto 3000) y el frontend (`cd frontend && npm run dev`, puerto 5173) y recorrer cada página para confirmar que carga sin errores.
- Reportar qué quedó igual al diseño, qué se adaptó y qué quedó pendiente por falta de datos en la API.
