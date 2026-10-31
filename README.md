# bot_telegram

Bot de Telegram para la **gestión de la bodega del Local 55**: registra las fotos y mensajes de los grupos de bodega, ventas y devoluciones, calcula el total de ventas y publica reportes en una página web local.

## Objetivo

Llevar el control de entradas y salidas de mercancía, ventas y devoluciones directamente desde los grupos de Telegram que ya usa el equipo, sin hojas de cálculo manuales.

## Lenguaje y tecnologías

- **JavaScript (Node.js)**
- [`telegraf`](https://telegraf.js.org/) para el bot de Telegram
- `express` y `serve-index` para el panel web local
- `dotenv` para la configuración

## Archivos

| Archivo | Descripción |
|---|---|
| `index_telegram_V27.js` | Versión actual del bot (la que ejecuta `monitor_telegram.bat`). |
| `index_telegram_V20.js`, `index_telegram_V24.js` | Versiones anteriores. |
| `sumador_ventas_V3.js` | Lee los logs del grupo de ventas y suma los precios para `/total`. |
| `devoluciones.js` | Procesa devoluciones: un administrador responde `d` a una foto. |
| `fotos_index.js` | Mantiene `fotos_index.json`, el índice de fotos guardadas y su estado. |
| `monitor_telegram.bat` | Lanzador para Windows. |
| `package.json` | Dependencias del proyecto. |

## Cómo funciona

El bot trabaja con tres grupos de Telegram:

| Grupo | Qué hace el bot |
|---|---|
| **Entra/sale-bodega 55** | Guarda la foto como *pendiente*. Al responderla con `v`, `va`, `c`, `b`, etc. (más talla, color, marca), la marca como *confirmada*. |
| **Ventas 55** | Guarda la foto y el precio escrito en la descripción (por ejemplo `120`). |
| **Devoluciones bodega** | Guarda la foto y el motivo. Un administrador responde `d` para registrar la devolución. |

Todo se guarda en la carpeta `sistema_bodega/` (`fotos/`, `reportes/`, `logs/`), que se crea sola.

### Comandos

| Comando | Descripción |
|---|---|
| `/total [AAAA-MM-DD]` | Total de ventas de hoy o de la fecha indicada. |
| `/ayudatotal` | Ayuda del comando `/total`. |
| `/status` | Estado del sistema. |
| `/groupid` | ID del chat actual (para configurar el `.env`). |
| `/myid` | Su ID de usuario. |

### Panel web

Con el bot en marcha:

- Panel: <http://localhost:3000>
- Fotos: <http://localhost:3000/fotos/>
- Reportes: <http://localhost:3000/reportes/>
- Logs: <http://localhost:3000/logs/>

## Instalación y uso

1. Instale **Node.js** (versión 18 o superior).
2. Instale las dependencias:

   ```bash
   npm install
   ```

3. Cree un archivo `.env` en la carpeta del proyecto:

   ```env
   TELEGRAM_BOT_TOKEN=token_que_da_BotFather
   GRUPO_CONFIRMACION_ID=-100xxxxxxxxxx
   GRUPO_VENTAS_ID=-100xxxxxxxxxx
   GRUPO_DEVOLUCIONES_ID=-100xxxxxxxxxx
   PORT=3000
   ```

   Para saber el ID de cada grupo, agregue el bot y escriba `/groupid` en el grupo. El bot debe tener desactivado el *modo privacidad* en BotFather para leer todos los mensajes del grupo.

4. Inicie el bot:

   ```bash
   node index_telegram_V27.js
   ```

   En Windows también puede usar `monitor_telegram.bat` (ajuste la ruta que tiene dentro).

## Notas

- **Nunca suba el archivo `.env` al repositorio**: contiene el token del bot. Conviene agregar un `.gitignore` con `.env`, `node_modules/`, `sistema_bodega/` y `fotos_index.json`.
- `npm start` ejecuta `index_telegram_V20.js` (versión antigua), mientras que el `.bat` usa la V27. Para usar la versión actual con `npm start`, cambie `main` y `start` en `package.json`.
- La ayuda de `/ayudatotal` menciona `/totalmes` y `/ultimas`, pero esos comandos todavía no están implementados en la V27.
