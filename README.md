# 📺 IPTV Manager

Panel de administración para gestionar tu propia lista IPTV dinámica. Genera un **único link M3U** que se actualiza en tiempo real sin necesidad de redeploy, con soporte completo para **TiviMate**.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Características

| Feature | Descripción |
|---|---|
| **🔗 Link único M3U** | Un solo link estable que se actualiza automáticamente al modificar tu lista |
| **📡 Múltiples fuentes** | Importá N listas M3U por URL o texto. Se combinan en un único link de salida |
| **🔍 Detección de duplicados** | Agrupa canales con misma URL o nombres similares (Telefe / Telefé HD) como alternativas |
| **🏥 Health checking** | Verifica todos los streams en background. Auto-switch al mejor alternativo si un canal cae |
| **✏️ Editor Raw M3U** | Edición directa del M3U como texto, sincronizada con la base de datos |
| **📺 Compatible TiviMate** | Headers, MIME types, atributos y encoding optimizados para TiviMate |
| **📅 Soporte EPG** | Configuración de URLs XMLTV incluidas en el header del M3U |
| **🔐 Login seguro** | bcryptjs + JWT en cookies HttpOnly + CSRF + rate limiting |

---

## 🚀 Inicio Rápido

### 1. Clonar e instalar

```bash
git clone <repo-url> iptv-manager
cd iptv-manager
npm install
```

### 2. Configurar entorno

```bash
cp .env.example .env
```

Editá `.env` y configurá al menos el `JWT_SECRET`:

```env
PORT=3000
JWT_SECRET=tu_secreto_muy_largo_y_aleatorio_aqui
NODE_ENV=development
```

> Generá un secreto seguro con:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

### 3. Crear usuario admin

```bash
npm run setup -- --username admin --password TuContraseñaSegura123!
```

### 4. Iniciar el servidor

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

El panel estará disponible en **http://127.0.0.1:3000**

---

## 📋 Uso

### Conectar en TiviMate

1. Abrí **⚙️ Configuración** en el panel admin
2. Copiá el link M3U (ej: `http://tu-servidor:3000/playlist/<token>/playlist.m3u`)
3. En TiviMate: **Add Playlist → M3U Playlist → Enter URL**
4. Pegá el link

Cada vez que modifiques canales en el panel, TiviMate recibirá la lista actualizada automáticamente en el siguiente refresh.

---

### Importar una lista M3U

**Opción A — Desde URL:**
1. Panel → **🔗 Fuentes M3U** → **+ Agregar URL**
2. Ingresá la URL de tu proveedor
3. Hacé clic en **🔄 Sincronizar**

**Opción B — Pegar contenido:**
1. Panel → **🔗 Fuentes M3U** → **📄 Pegar M3U**
2. Pegá el contenido de tu archivo `.m3u`

Podés agregar múltiples fuentes. Todas se combinan en el único link de salida.

---

### Detección de duplicados

Después de importar, el sistema detecta automáticamente canales duplicados:
- **Por URL:** misma IP/dominio
- **Por nombre:** similitud ≥ 80% (configurable) — ej: "Telefe" y "Telefé HD"

Ve a **🔍 Duplicados** → revisá los grupos detectados → elegí cuál es el canal principal → **Agrupar**.

Los duplicados se convierten en *alternativas*: no aparecen dos veces en TiviMate, pero el health checker puede switchear automáticamente al mejor si el principal cae.

---

### Health Checking

El sistema verifica todos los streams cada **15 minutos** (configurable):

| Estado | Indicador | Condición |
|---|---|---|
| ✅ Saludable | 🟢 | Responde en < 1s |
| ⚠️ Lento | 🟡 | Responde en 1–5s |
| ❌ Caído | 🔴 | Timeout o error |

**Auto-switch:** Si un canal principal cae y tiene alternativas saludables, el M3U generado automáticamente usa la mejor alternativa hasta que el principal se recupere.

---

### Editor Raw M3U

Panel → **✏️ Editor Raw** → editá directamente el texto M3U → **✅ Aplicar cambios**

Los cambios se sincronizan bidireccionalmente con la base de datos:
- Canales nuevos en el texto → se crean en la DB
- Canales editados → se actualizan en la DB
- Canales eliminados del texto → se desactivan en la DB (sin borrado definitivo)

---

## 📁 Estructura del Proyecto

```
iptv-manager/
├── src/
│   ├── server.js                 # Servidor Express
│   ├── config.js                 # Configuración y secretos
│   ├── db/
│   │   ├── database.js           # SQLite + schema
│   │   └── seed.js               # CLI para crear admin
│   ├── middleware/
│   │   └── auth.js               # JWT + CSRF middleware
│   ├── routes/
│   │   ├── auth.js               # Login / logout
│   │   ├── channels.js           # CRUD canales + alternativas
│   │   ├── groups.js             # CRUD grupos
│   │   ├── sources.js            # Fuentes M3U
│   │   ├── settings.js           # Configuración
│   │   ├── health.js             # Estado de streams
│   │   ├── raw-editor.js         # Editor raw M3U
│   │   └── playlist.js           # Endpoint M3U público
│   └── services/
│       ├── m3u-parser.js         # Parser M3U/M3U8
│       ├── m3u-generator.js      # Generador M3U dinámico
│       ├── duplicate-detector.js # Detección por URL y nombre
│       └── health-checker.js     # Background job + auto-switch
├── public/
│   ├── index.html                # SPA
│   ├── css/styles.css            # Design system dark mode
│   └── js/
│       ├── app.js                # Router + API client + CSRF
│       ├── auth.js               # Login
│       ├── channels.js           # UI Canales
│       ├── groups.js             # UI Grupos
│       ├── sources.js            # UI Fuentes
│       ├── duplicates.js         # UI Duplicados
│       ├── health.js             # UI Health
│       ├── raw-editor.js         # UI Editor Raw
│       └── settings.js           # UI Configuración
├── data/                         # SQLite DB (gitignored)
├── .env.example
├── package.json
└── README.md
```

---

## 🔌 API Reference

Todos los endpoints de `/api/*` requieren autenticación (cookie de sesión + header `X-CSRF-Token`).

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/channels` | Lista canales (filtros: groupId, health, search) |
| `POST` | `/api/channels` | Crear canal |
| `PUT` | `/api/channels/:id` | Editar canal |
| `DELETE` | `/api/channels/:id` | Eliminar canal |
| `GET` | `/api/channels/duplicates` | Detectar duplicados |
| `POST` | `/api/channels/bulk-alternatives` | Agrupar duplicados |
| `GET` | `/api/sources` | Lista fuentes |
| `POST` | `/api/sources/:id/sync` | Sincronizar fuente desde URL |
| `POST` | `/api/sources/import-text` | Importar M3U desde texto |
| `GET` | `/api/health/status` | Resumen de salud |
| `POST` | `/api/health/check-now` | Forzar verificación de todos |
| `GET` | `/api/raw/preview` | Ver M3U generado como texto |
| `PUT` | `/api/raw/apply` | Aplicar M3U editado a la DB |
| `GET` | `/api/settings` | Obtener configuración |
| `PUT` | `/api/settings` | Actualizar configuración |
| **`GET`** | **`/playlist/:token/playlist.m3u`** | **🌐 Link público M3U (sin auth)** |

---

## ⚙️ Variables de Entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `NODE_ENV` | `development` | Entorno (`development` / `production`) |
| `JWT_SECRET` | *(auto-generado)* | Secreto JWT — **configurar en producción** |
| `HEALTH_CHECK_INTERVAL_MS` | `900000` | Intervalo de health check (ms) — default 15 min |
| `HEALTH_CHECK_TIMEOUT_MS` | `5000` | Timeout por stream (ms) |
| `DUPLICATE_SIMILARITY_THRESHOLD` | `80` | Umbral de similitud de nombres (0–100) |

---

## 🛡️ Seguridad

- **Contraseñas:** hasheadas con `bcryptjs` (salt rounds = 12)
- **Sesiones:** JWT firmado con HS256 en cookie `__Host-session` (HttpOnly, Secure, SameSite=Strict)
- **CSRF:** Double Submit Cookie pattern en todas las rutas mutantes
- **Rate limiting:** 5 intentos de login por minuto, 200 req/min en API
- **Headers:** `helmet` con CSP estricto, X-Frame-Options DENY, X-Content-Type-Options nosniff
- **SQL:** `better-sqlite3` con prepared statements (sin concatenación de strings)
- **Secrets:** Nunca hardcodeados — env vars con fallback a generación segura + warning
- **Servidor:** Escucha en `127.0.0.1` (localhost) — usar reverse proxy para exponer públicamente
- **Link público:** Token UUID no predecible; rate limited a 60 req/min

> **TODO(security):** Para producción se recomienda configurar OAuth provider y MFA.

---

## 🌐 Deployment con Nginx (Producción)

```nginx
server {
    listen 443 ssl;
    server_name iptv.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/iptv.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/iptv.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Asegurate de configurar `NODE_ENV=production` en el `.env` para activar las cookies `Secure`.

---

## 📦 Dependencias

| Paquete | Versión | Uso |
|---|---|---|
| `express` | ^4.18 | Framework HTTP |
| `better-sqlite3` | ^12.11 | Base de datos SQLite (compatible Node 24) |
| `bcryptjs` | ^2.4 | Hash de contraseñas (pure JS, sin compilación nativa) |
| `jsonwebtoken` | ^9.0 | Generación y verificación de JWT |
| `cookie-parser` | ^1.4 | Parsing de cookies |
| `helmet` | ^7.1 | Headers de seguridad HTTP |
| `express-rate-limit` | ^7.2 | Rate limiting |
| `uuid` | ^11 | Generación de tokens UUID |

---

## 📝 Licencia

MIT — Libre para uso personal y comercial.
