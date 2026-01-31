// index_telegram_V20.js
/**
 * VERSIÓN TELEGRAM - Replica todas las funcionalidades del bot de WhatsApp
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const serveIndex = require('serve-index');
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
require('dotenv').config();

const app = express();
app.use(express.json());

/* ---------- CONFIGURACIÓN ---------- */
const PORT = 3000;
//const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TU_TOKEN_AQUÍ';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const MEDIA_DIR = path.join(__dirname, 'media_telegram');
const MEDIA_ORIGINALES = path.join(MEDIA_DIR, 'originales');
const CARPETA_REPORTES = path.join(__dirname, 'reporte_bodega_telegram');
const CARPETA_JSON = path.join(CARPETA_REPORTES, 'reportes_json');
const CARPETA_HTML = path.join(CARPETA_REPORTES, 'reportes_html');
const CARPETA_ANOTACIONES = path.join(CARPETA_REPORTES, 'anotaciones');

const ARCHIVO_DEVOLUCIONES = path.join(CARPETA_REPORTES, 'devoluciones.json');
const ARCHIVO_CONFIRMACIONES = path.join(CARPETA_REPORTES, 'confirmaciones.json');

// Grupos permitidos (IDs de grupo de Telegram)
// Para obtener el ID del grupo: agregar el bot al grupo y enviar /groupid
const gruposPermitidos = {
    "Ventas 55": process.env.GRUPO_VENTAS_ID,
    "Entra/sale-bodega 55": process.env.GRUPO_CONFIRMACION_ID,
    "Devoluciones bodega": process.env.GRUPO_DEVOLUCIONES_ID
};

/*const gruposPermitidos = {
    "Ventas 55": -1001234567890, // Reemplazar con ID real
    "Entra/sale-bodega 55": -1002345678901,
    "Devoluciones bodega": -1003456789012
};*/

const GRUPO_CONFIRMACION = "Entra/sale-bodega 55";
const GRUPO_VENTAS = "Ventas 55";
const confirmacionesValidas = ['v', 'va', 'c', 'ca', 'b', 'ba', 'van', 'voy', 'bv', 'bc'];

/* ---------- INICIALIZAR DIRECTORIOS ---------- */
[CARPETA_REPORTES, CARPETA_JSON, CARPETA_HTML, MEDIA_DIR, MEDIA_ORIGINALES, CARPETA_ANOTACIONES].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ---------- ESTADO EN MEMORIA ---------- */
let confirmaciones = {
    fotosPendientes: new Map(),
    fotosConfirmadas: new Map()
};

let devoluciones = {};
let ultimosMensajes = new Map(); // Para manejar replies

/* ---------- FUNCIONES DE PERSISTENCIA ---------- */
function cargarConfirmacionesPersistentes() {
    try {
        if (fs.existsSync(ARCHIVO_CONFIRMACIONES)) {
            const raw = JSON.parse(fs.readFileSync(ARCHIVO_CONFIRMACIONES, 'utf8'));
            confirmaciones.fotosPendientes = new Map(raw.fotosPendientes || []);
            confirmaciones.fotosConfirmadas = new Map(raw.fotosConfirmadas || []);
            console.log(`📂 Confirmaciones cargadas (${confirmaciones.fotosConfirmadas.size} confirmadas, ${confirmaciones.fotosPendientes.size} pendientes)`);
        }
    } catch (err) {
        console.warn('⚠️ Error cargando confirmaciones:', err.message);
    }
}

function guardarConfirmacionesPersistentes() {
    const dump = {
        fotosPendientes: Array.from(confirmaciones.fotosPendientes.entries()),
        fotosConfirmadas: Array.from(confirmaciones.fotosConfirmadas.entries())
    };
    fs.writeFileSync(ARCHIVO_CONFIRMACIONES, JSON.stringify(dump, null, 2), 'utf8');
}

function cargarDevolucionesPersistentes() {
    try {
        if (fs.existsSync(ARCHIVO_DEVOLUCIONES)) {
            devoluciones = JSON.parse(fs.readFileSync(ARCHIVO_DEVOLUCIONES, 'utf8'));
        }
    } catch (err) {
        console.warn('⚠️ Error cargando devoluciones:', err.message);
    }
}

function guardarDevolucionesPersistentes() {
    fs.writeFileSync(ARCHIVO_DEVOLUCIONES, JSON.stringify(devoluciones, null, 2), 'utf8');
}

// Cargar datos
cargarConfirmacionesPersistentes();
cargarDevolucionesPersistentes();

/* ---------- FUNCIONES DEL SISTEMA ---------- */
function guardarFotoInmutable(fileBuffer, fileId, fechaTexto, nombreGrupo) {
    try {
        const ext = 'jpg'; // Telegram generalmente usa jpg
        const filename = `${Date.now()}_${fileId}.${ext}`;

        const carpetaOriginales = path.join(MEDIA_ORIGINALES, nombreGrupo, fechaTexto);
        if (!fs.existsSync(carpetaOriginales)) fs.mkdirSync(carpetaOriginales, { recursive: true });

        const rutaOriginal = path.join(carpetaOriginales, filename);
        const rutaTrabajo = path.join(MEDIA_DIR, nombreGrupo, fechaTexto, filename);
        const carpetaTrabajo = path.dirname(rutaTrabajo);
        if (!fs.existsSync(carpetaTrabajo)) fs.mkdirSync(carpetaTrabajo, { recursive: true });

        fs.writeFileSync(rutaOriginal, fileBuffer);
        fs.writeFileSync(rutaTrabajo, fileBuffer);

        return {
            rutaOriginal: rutaOriginal,
            rutaTrabajo: rutaTrabajo,
            nombreArchivo: filename,
            fileId: fileId
        };
    } catch (error) {
        console.error('❌ Error guardando foto:', error);
        throw error;
    }
}

function extraerInformacion(mensaje = '') {
    const texto = mensaje.toLowerCase();
    const tallas = (texto.match(/\b(\d{1,2}(?:\.\d)?)\b/g) || [])
        .filter(t => parseFloat(t) >= 20 && parseFloat(t) <= 50);

    let color = null;
    const colorMatch1 = texto.match(/(?:de la|la)\s+(\w+)/i);
    if (colorMatch1) {
        color = colorMatch1[1];
    } else {
        const colorMatch2 = texto.match(/(?:color)\s+(\w+)/i);
        if (colorMatch2) color = colorMatch2[1];
    }

    return { tallas, color };
}

function confirmarFoto(fotoId, mensaje, usuarioInfo, timestamp) {
    const fotoData = confirmaciones.fotosPendientes.get(fotoId);
    const { tallas, color } = extraerInformacion(mensaje);

    confirmaciones.fotosConfirmadas.set(fotoId, {
        ...fotoData,
        confirmador: usuarioInfo.nombre,
        confirmadorId: usuarioInfo.id,
        confirmacionTimestamp: timestamp.toISOString(),
        mensajeConfirmacion: mensaje,
        tallas,
        color,
        devuelta: false,
        productosDevueltos: []
    });
    confirmaciones.fotosPendientes.delete(fotoId);
    guardarConfirmacionesPersistentes();
    console.log(`✅ Confirmada: ${fotoData.nombreArchivo}, Tallas: ${tallas.join(', ')}, Color: ${color || 'N/A'}`);
}

/* ---------- EXPRESS SERVER (IGUAL QUE WHATSAPP) ---------- */
app.use('/media_telegram', express.static(MEDIA_DIR), serveIndex(MEDIA_DIR, { icons: true }));
app.use('/reporte_telegram', express.static(CARPETA_HTML));
app.use('/anotaciones_telegram', express.static(CARPETA_ANOTACIONES));
app.use('/originales_telegram', express.static(MEDIA_ORIGINALES));

app.get('/anotacion_telegram/:fotoId', (req, res) => {
    const anotacionPath = path.join(CARPETA_ANOTACIONES, `${req.params.fotoId}.json`);
    if (fs.existsSync(anotacionPath)) {
        res.sendFile(anotacionPath);
    } else {
        res.status(404).json({ error: 'Anotación no encontrada' });
    }
});

app.get('/reportes_telegram', (req, res) => {
    const archivos = fs.readdirSync(CARPETA_HTML).filter(f => f.endsWith('.html')).sort().reverse();
    const links = archivos.map(f => `<li><a href="/reporte_telegram/${f}" target="_blank">${f}</a></li>`).join('');
    res.send(`<h1>Reportes Telegram disponibles</h1><ul>${links}</ul><p><a href="/telegram">⬅️ Volver</a></p>`);
});

app.get('/telegram', (req, res) => {
    const archivos = fs.readdirSync(CARPETA_HTML).filter(f => f.endsWith('.html')).sort().reverse();
    if (!archivos.length) return res.send('No hay reportes generados aún.');
    res.redirect(`/reporte_telegram/${archivos[0]}`);
});

app.post('/marcar-devolucion-telegram', (req, res) => {
    const { fotoId, observaciones = '', usuario = 'Usuario Bodega', productosDevueltos = [] } = req.body;
    if (!fotoId) return res.status(400).json({ success: false, message: 'fotoId requerido' });

    if (!confirmaciones.fotosConfirmadas.has(fotoId)) {
        return res.status(404).json({ success: false, message: 'Foto no encontrada entre confirmadas' });
    }

    const fotoData = confirmaciones.fotosConfirmadas.get(fotoId);
    fotoData.devuelta = true;
    fotoData.productosDevueltos = productosDevueltos;

    devoluciones[fotoId] = {
        nombreArchivo: fotoData.nombreArchivo,
        devueltaPor: usuario,
        fechaDevolucion: new Date().toISOString(),
        observaciones,
        productosDevueltos: productosDevueltos,
        devolucionParcial: productosDevueltos.length > 0,
        cantidadProductos: productosDevueltos.length
    };

    guardarDevolucionesPersistentes();
    guardarConfirmacionesPersistentes();
    generarReporteConfirmaciones();

    res.json({ success: true });
});

app.post('/guardar-anotacion-telegram', (req, res) => {
    const { fotoId, anotaciones } = req.body;
    if (!fotoId || !anotaciones) return res.status(400).json({ success: false, message: 'fotoId y anotaciones requeridos' });

    try {
        const anotacionPath = path.join(CARPETA_ANOTACIONES, `${fotoId}.json`);
        if (fs.existsSync(anotacionPath)) {
            const fechaActual = new Date().toISOString().split('T')[0];
            const backupDir = path.join(CARPETA_ANOTACIONES, 'backups', fechaActual);
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, `${fotoId}_${Date.now()}.json`);
            fs.copyFileSync(anotacionPath, backupPath);
        }
        fs.writeFileSync(anotacionPath, JSON.stringify(anotaciones, null, 2), 'utf8');
        res.json({ success: true });
    } catch (error) {
        console.error('Error guardando anotación:', error);
        res.status(500).json({ success: false, message: 'Error guardando anotación' });
    }
});

/* ---------- TELEGRAM BOT ---------- */
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'TU_TOKEN_AQUÍ') {
    console.error('❌ ERROR: Necesitas configurar el token del bot de Telegram');
    console.log('1. Habla con @BotFather en Telegram');
    console.log('2. Crea un nuevo bot con /newbot');
    console.log('3. Copia el token y configúralo en la variable TELEGRAM_BOT_TOKEN');
    console.log('4. Agrega el bot a los grupos y hazlo administrador');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Comando para obtener ID del grupo
bot.command('groupid', async (ctx) => {
    const chatId = ctx.chat.id;
    await ctx.reply(`🆔 ID de este grupo: \`${chatId}\``, { parse_mode: 'Markdown' });
});

// Comando para obtener ID del usuario
bot.command('myid', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.reply(`🆔 Tu ID de usuario: \`${userId}\``, { parse_mode: 'Markdown' });
});

// Comando para verificar estado
bot.command('status', async (ctx) => {
    const grupoNombre = Object.keys(gruposPermitidos).find(key => gruposPermitidos[key] === ctx.chat.id);
    const estaPermitido = grupoNombre !== undefined;
    
    await ctx.reply(
        `📊 Estado del bot:\n` +
        `• Grupo actual: ${ctx.chat.title || 'Privado'}\n` +
        `• ID Grupo: ${ctx.chat.id}\n` +
        `• Permisos: ${estaPermitido ? '✅ Autorizado' : '❌ No autorizado'}\n` +
        `• Nombre configurado: ${grupoNombre || 'No encontrado'}\n` +
        `• Fotos pendientes: ${confirmaciones.fotosPendientes.size}\n` +
        `• Fotos confirmadas: ${confirmaciones.fotosConfirmadas.size}`
    );
});

// Manejo de fotos
bot.on('photo', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const grupoNombre = Object.keys(gruposPermitidos).find(key => gruposPermitidos[key] === chatId);
        
        if (!grupoNombre) {
            console.log(`❌ Grupo no permitido: ${chatId}`);
            return;
        }

        const usuarioInfo = {
            id: ctx.from.id,
            nombre: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario',
            username: ctx.from.username
        };

        const fecha = new Date();
        const fechaLocal = new Date(fecha.getTime() - (fecha.getTimezoneOffset() * 60000));
        const fechaTexto = fechaLocal.toISOString().split('T')[0];
        const horaTexto = fecha.toLocaleTimeString('es-CO', { hour12: false });
        const fechaHora = `${fechaTexto} ${horaTexto}`;

        const nombreGrupo = grupoNombre.replace(/[^a-zA-Z0-9]/g, '_');
        const logsDir = path.join(__dirname, 'logs_telegram', nombreGrupo);
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        const logPath = path.join(logsDir, `${fechaTexto}.txt`);
        fs.appendFileSync(logPath, `${fechaHora} ${usuarioInfo.nombre}: [Foto]\n`, 'utf8');

        // Obtener la foto de mayor calidad
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;
        const file = await bot.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        // Descargar la imagen
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.buffer();

        // Guardar la foto
        const rutasFoto = guardarFotoInmutable(buffer, fileId, fechaTexto, nombreGrupo);

        console.log(`📦 Foto guardada de Telegram: ${rutasFoto.nombreArchivo}`);

        // Guardar referencia al mensaje para replies
        const messageId = ctx.message.message_id;
        ultimosMensajes.set(messageId, {
            fileId: fileId,
            nombreArchivo: rutasFoto.nombreArchivo,
            timestamp: fecha.toISOString(),
            usuario: usuarioInfo
        });

        fs.appendFileSync(logPath, `${fechaHora} ${usuarioInfo.nombre}: [Archivo: ${rutasFoto.nombreArchivo}]\n`, 'utf8');

        // Si es grupo de confirmación, marcar como pendiente
        if (grupoNombre === GRUPO_CONFIRMACION) {
            const fotoId = fileId;
            confirmaciones.fotosPendientes.set(fotoId, {
                timestamp: fecha.toISOString(),
                autor: usuarioInfo.nombre,
                autorId: usuarioInfo.id,
                nombreArchivo: rutasFoto.nombreArchivo,
                rutaArchivo: rutasFoto.rutaOriginal,
                rutaTrabajo: rutasFoto.rutaTrabajo,
                caption: ctx.message.caption || '',
                fechaFoto: fechaTexto,
                messageId: messageId
            });
            guardarConfirmacionesPersistentes();
            console.log(`📸 Foto pendiente registrada: ${rutasFoto.nombreArchivo}`);
        }

        // Si es grupo de ventas
        if (grupoNombre === GRUPO_VENTAS) {
            console.log(`🛍️  Foto en Ventas: ${rutasFoto.nombreArchivo}`);
            fs.appendFileSync(logPath, `${fechaHora} ${usuarioInfo.nombre}: [Venta - Archivo: ${rutasFoto.nombreArchivo}]\n`, 'utf8');
        }

    } catch (error) {
        console.error('❌ Error procesando foto de Telegram:', error);
    }
});

// Manejo de mensajes de texto (para confirmaciones)
bot.on('text', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const grupoNombre = Object.keys(gruposPermitidos).find(key => gruposPermitidos[key] === chatId);
        
        if (!grupoNombre || grupoNombre !== GRUPO_CONFIRMACION) {
            return;
        }

        const texto = ctx.message.text.toLowerCase().trim();
        const esConfirmacion = confirmacionesValidas.some(conf => texto.startsWith(conf));

        if (!esConfirmacion) return;

        const usuarioInfo = {
            id: ctx.from.id,
            nombre: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario'
        };

        const fecha = new Date();
        const logsDir = path.join(__dirname, 'logs_telegram', grupoNombre.replace(/[^a-zA-Z0-9]/g, '_'));
        const fechaTexto = new Date(fecha.getTime() - (fecha.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const logPath = path.join(logsDir, `${fechaTexto}.txt`);
        
        // Verificar si es respuesta a un mensaje
        if (ctx.message.reply_to_message && ctx.message.reply_to_message.photo) {
            const repliedMessage = ctx.message.reply_to_message;
            const repliedPhoto = repliedMessage.photo[repliedMessage.photo.length - 1];
            const repliedFileId = repliedPhoto.file_id;

            // Buscar la foto pendiente por fileId
            let fotoIdEncontrada = null;
            for (const [fotoId, datos] of confirmaciones.fotosPendientes.entries()) {
                if (datos.messageId === repliedMessage.message_id) {
                    fotoIdEncontrada = fotoId;
                    break;
                }
            }

            if (fotoIdEncontrada && confirmaciones.fotosPendientes.has(fotoIdEncontrada)) {
                confirmarFoto(fotoIdEncontrada, ctx.message.text, usuarioInfo, fecha);
                console.log(`✅ Confirmación por REPLY en Telegram: ${fotoIdEncontrada}`);
                
                fs.appendFileSync(logPath, 
                    `${fecha.toLocaleTimeString('es-CO', { hour12: false })} ${usuarioInfo.nombre}: ✅ CONFIRMÓ: ${ctx.message.text}\n`, 
                    'utf8'
                );
                
                // Responder al usuario
                await ctx.reply(`✅ Confirmación registrada para la foto.`, {
                    reply_to_message_id: ctx.message.message_id
                });
                
                generarReporteConfirmaciones();
            }
        }

    } catch (error) {
        console.error('❌ Error procesando texto en Telegram:', error);
    }
});

// Manejo de documentos (por si envían archivos)
bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id;
    const grupoNombre = Object.keys(gruposPermitidos).find(key => gruposPermitidos[key] === chatId);
    
    if (grupoNombre) {
        console.log(`📄 Documento recibido en ${grupoNombre}: ${ctx.message.document.file_name}`);
        // Podrías añadir lógica similar para documentos si es necesario
    }
});

/* ---------- FUNCIÓN DE REPORTES (REUTILIZADA) ---------- */
function generarReporteConfirmaciones() {
    const ahora = new Date();
    const fechaLocal = new Date(ahora.getTime() - (ahora.getTimezoneOffset() * 60000));
    const fechaActual = fechaLocal.toISOString().split('T')[0];

    const fotosConfirmadasHoy = Array.from(confirmaciones.fotosConfirmadas.entries())
        .filter(([id, data]) => {
            const fechaFoto = new Date(data.timestamp).toISOString().split('T')[0];
            return fechaFoto === fechaActual;
        });

    const fotosPendientesHoy = Array.from(confirmaciones.fotosPendientes.entries())
        .filter(([id, data]) => {
            const fechaFoto = new Date(data.timestamp).toISOString().split('T')[0];
            return fechaFoto === fechaActual;
        });

    const devolucionesHoy = Object.keys(devoluciones).filter(id => {
        const fechaDevolucion = new Date(devoluciones[id].fechaDevolucion).toISOString().split('T')[0];
        return fechaDevolucion === fechaActual;
    });

    const reporte = {
        fechaReporte: fechaActual,
        totalFotosConfirmadas: fotosConfirmadasHoy.length,
        totalFotosRecibidas: fotosConfirmadasHoy.length + fotosPendientesHoy.length,
        fotosNoConfirmadas: fotosPendientesHoy.length,
        fotosDevueltas: devolucionesHoy.length,
        ultimaActualizacion: ahora.toISOString(),
        fotosConfirmadas: fotosConfirmadasHoy.map(([id, data]) => ({
            id,
            ...data,
            devuelta: devoluciones.hasOwnProperty(id),
            productosDevueltos: devoluciones[id]?.productosDevueltos || []
        }))
    };

    const jsonPath = path.join(CARPETA_JSON, `${fechaActual}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(reporte, null, 2), 'utf8');

    generarReporteHTML(reporte);
}

function generarReporteHTML(reporte) {
    // Misma función que en el bot de WhatsApp, pero ajustando las rutas
    const fechaActual = reporte.fechaReporte;

    const formatoFechaHora = (fechaISO) => {
        if (!fechaISO) return 'N/A';
        const fecha = new Date(fechaISO);
        return fecha.toLocaleString('es-CO', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    // HTML similar al original pero con rutas ajustadas para Telegram
    let html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte Bodega Telegram - ${fechaActual}</title>
    <style>
        /* MISMO CSS QUE LA VERSIÓN WHATSAPP */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
            padding: 30px;
        }
        
        .header {
            text-align: center;
            padding-bottom: 30px;
            border-bottom: 3px solid #f0f0f0;
            margin-bottom: 30px;
        }
        
        .header h1 {
            color: #333;
            font-size: 2.5em;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
        }
        
        .badge {
            background: linear-gradient(135deg, #0088cc 0%, #34b7f1 100%);
            color: white;
            padding: 8px 20px;
            border-radius: 50px;
            font-size: 0.8em;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(0, 136, 204, 0.4);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .stat-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            border: 2px solid transparent;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.2);
        }
        
        .stat-number {
            font-size: 3em;
            font-weight: bold;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #0088cc 0%, #34b7f1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .stat-title {
            color: #666;
            font-size: 1.1em;
            font-weight: 500;
        }
        
        .total-card { border-color: #3498db; }
        .confirmadas-card { border-color: #2ecc71; }
        .pendientes-card { border-color: #f39c12; }
        .devueltas-card { border-color: #e74c3c; }
        
        /* ... resto del CSS idéntico ... */
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                📊 Reporte Bodega Telegram - ${fechaActual}
                <span class="badge">TELEGRAM V20</span>
            </h1>
            <p style="color: #666; margin-top: 10px;">
                Última actualización: ${formatoFechaHora(reporte.ultimaActualizacion)}
            </p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card total-card">
                <div class="stat-number" style="color: #3498db;">${reporte.totalFotosRecibidas}</div>
                <div class="stat-title">Total Recibidas</div>
            </div>
            
            <div class="stat-card confirmadas-card">
                <div class="stat-number" style="color: #2ecc71;">${reporte.totalFotosConfirmadas}</div>
                <div class="stat-title">Confirmadas</div>
            </div>
            
            <div class="stat-card pendientes-card">
                <div class="stat-number" style="color: #f39c12;">${reporte.fotosNoConfirmadas}</div>
                <div class="stat-title">Pendientes</div>
            </div>
            
            <div class="stat-card devueltas-card">
                <div class="stat-number" style="color: #e74c3c;">${reporte.fotosDevueltas}</div>
                <div class="stat-title">Devueltas</div>
            </div>
        </div>
        
        <div class="photos-section">
            <h2 class="section-title">
                📸 Fotos Confirmadas (${reporte.fotosConfirmadas.length})
            </h2>
            
            <div class="photo-grid">
`;

    // Generar tarjetas para cada foto
    reporte.fotosConfirmadas.forEach(foto => {
        const rel = path.relative(MEDIA_ORIGINALES, foto.rutaArchivo).split(path.sep).join('/');
        const imgSrc = `/originales_telegram/${rel}`;
        const devuelta = foto.devuelta;
        const devolucionParcial = devuelta && foto.productosDevueltos && foto.productosDevueltos.length > 0;

        const horaSolicitud = formatoFechaHora(foto.timestamp);
        const horaConfirmacion = formatoFechaHora(foto.confirmacionTimestamp);

        const tallasHTML = foto.tallas && foto.tallas.length
            ? foto.tallas.map(t => `<span class="sizes-badge">${t}</span>`).join('')
            : '<span style="color: #95a5a6;">No especificadas</span>';

        const colorHTML = foto.color
            ? `<span class="color-badge">${foto.color}</span>`
            : '<span style="color: #95a5a6;">No especificado</span>';

        const observ = devoluciones[foto.id] && devoluciones[foto.id].observaciones
            ? `<div class="observations"><strong>📝 Observaciones:</strong> ${devoluciones[foto.id].observaciones}</div>`
            : '';

        const cantidadProductos = devoluciones[foto.id]?.cantidadProductos || 0;

        const productosInfo = devolucionParcial
            ? `<div class="products-list">
                  <strong>✅ Productos devueltos:</strong>
                  <span class="product-counter">${cantidadProductos} producto(s)</span>
                  ${foto.productosDevueltos.map((p, i) =>
                `<div class="product-item">
                          <span>${p.nombre || `Producto ${i + 1}`}</span>
                          <span>${p.cantidad || 1} unidad(es)</span>
                       </div>`
            ).join('')}
               </div>`
            : '';

        let estadoHTML = '';
        let estadoClase = '';

        if (devuelta) {
            if (devolucionParcial) {
                estadoHTML = `<span class="status-badge status-partial">🔄 DEVOLUCIÓN PARCIAL</span>`;
                estadoClase = 'devuelta-parcial';
            } else {
                estadoHTML = `<span class="status-badge status-returned">✅ DEVUELTO</span>`;
                estadoClase = 'devuelta';
            }
        } else {
            estadoHTML = `<span class="status-badge status-pending">⏳ PENDIENTE DEVOLUCIÓN</span>`;
        }

        html += `
                <div class="photo-card ${estadoClase}" id="foto-${foto.id}">
                    <img src="${imgSrc}" 
                         alt="${foto.nombreArchivo}" 
                         class="photo-image"
                         onclick="abrirAnotador('${foto.id}', '${imgSrc}', '${foto.timestamp}')"
                         onerror="this.src='https://via.placeholder.com/350x200?text=Imagen+no+disponible'">
                    
                    <div class="photo-info">
                        <div class="photo-header">
                            <div class="photo-title">${foto.nombreArchivo}</div>
                            ${estadoHTML}
                        </div>
                        
                        <div class="photo-details">
                            <div class="detail-row">
                                <span class="detail-label">👤 De:</span>
                                <span class="detail-value">${foto.autor}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">✅ Confirmó:</span>
                                <span class="detail-value">${foto.confirmador}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">📅 Solicitud:</span>
                                <span class="detail-value">${horaSolicitud}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">✅ Confirmación:</span>
                                <span class="detail-value">${horaConfirmacion}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">🧵 Tallas:</span>
                                <span class="detail-value">${tallasHTML}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">🎨 Color:</span>
                                <span class="detail-value">${colorHTML}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">💬 Mensaje:</span>
                                <span class="detail-value" style="font-style: italic;">"${foto.mensajeConfirmacion || 'Sin mensaje'}"</span>
                            </div>
                        </div>
                        
                        ${observ}
                        ${productosInfo}
                        
                        <div class="actions">
                            ${devuelta
                ? (devolucionParcial
                    ? '<button class="btn btn-disabled" disabled>✅ Devolución parcial registrada</button>'
                    : '<button class="btn btn-disabled" disabled>✅ Ya devuelto</button>'
                )
                : `<button class="btn btn-return" onclick="marcarDevolucionCompleta('${foto.id}', this)">
                                    🔄 Marcar como devuelto
                                   </button>
                                   <button class="btn btn-annotate" onclick="abrirAnotador('${foto.id}', '${imgSrc}', '${foto.timestamp}')">
                                    ✏️ Anotar productos
                                   </button>`
            }
                        </div>
                    </div>
                </div>`;
    });

    html += `
            </div>
        </div>
    </div>

    <!-- Modal de Anotaciones (Mismo que WhatsApp) -->
    <div id="modalAnotacion" class="modal">
        <div class="modal-content">
            <span class="close-modal" onclick="cerrarAnotador()">&times;</span>
            
            <h2 style="margin-bottom: 20px;">
                ✏️ Anotar Productos Devueltos
                <span id="badgeInmutable" class="protection-badge" style="display: none;">SOLO LECTURA</span>
            </h2>
            
            <div id="advertenciaAnotacion" class="warning-box" style="display: none;">
                ⚠️ <strong>Foto de día anterior</strong><br>
                Las anotaciones son de solo lectura para mantener la integridad de los datos históricos.
            </div>
            
            <!-- ... resto del modal idéntico ... -->
            
        </div>
    </div>

    <script>
        // Variables globales
        let anotaciones = [];
        let herramienta = 'circulo';
        let canvas, ctx, imagen;
        let fotoActual, imgSrcActual, puedeEditarActual;
        let dibujando = false;
        let inicioX, inicioY;
        
        // Inicializar protección inmutable
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.photo-card').forEach(card => {
                const fotoId = card.id.replace('foto-', '');
                const imgElement = card.querySelector('img');
                const timestamp = imgElement.getAttribute('onclick').match(/'([^']+)'/)[3];
                
                if (timestamp) {
                    const puedeEditar = esFotoDeHoy(timestamp);
                    if (!puedeEditar) {
                        const annotateBtn = card.querySelector('.btn-annotate');
                        if (annotateBtn) {
                            annotateBtn.innerHTML = '🔒 Anotación bloqueada';
                            annotateBtn.classList.remove('btn-annotate');
                            annotateBtn.classList.add('btn-disabled');
                            annotateBtn.disabled = true;
                            annotateBtn.onclick = null;
                        }
                    }
                }
            });
        });
        
        function esFotoDeHoy(timestamp) {
            const fechaFoto = new Date(timestamp);
            const hoy = new Date();
            return fechaFoto.toDateString() === hoy.toDateString();
        }
        
        function abrirAnotador(fotoId, imgSrc, timestamp) {
            puedeEditarActual = esFotoDeHoy(timestamp);
            fotoActual = fotoId;
            imgSrcActual = imgSrc;
            anotaciones = [];
            
            // Configurar interfaz según permisos
            const badgeInmutable = document.getElementById('badgeInmutable');
            const advertencia = document.getElementById('advertenciaAnotacion');
            const btnFinalizar = document.getElementById('btnFinalizar');
            
            if (puedeEditarActual) {
                badgeInmutable.style.display = 'none';
                advertencia.style.display = 'none';
                btnFinalizar.disabled = false;
            } else {
                badgeInmutable.style.display = 'inline-block';
                advertencia.style.display = 'block';
                btnFinalizar.disabled = true;
                btnFinalizar.style.opacity = '0.5';
            }
            
            // Cargar anotaciones existentes
            fetch('/anotacion_telegram/' + fotoId)
                .then(response => {
                    if (!response.ok) throw new Error('No hay anotaciones previas');
                    return response.json();
                })
                .then(data => {
                    anotaciones = data;
                })
                .catch(() => {
                    console.log('No hay anotaciones previas');
                })
                .finally(() => {
                    inicializarCanvas();
                });
            
            document.getElementById('modalAnotacion').style.display = 'block';
        }
        
        function cerrarAnotador() {
            document.getElementById('modalAnotacion').style.display = 'none';
            anotaciones = [];
        }
        
        function inicializarCanvas() {
            // ... misma función que en WhatsApp ...
        }
        
        function cambiarHerramienta(nuevaHerramienta) {
            // ... misma función que en WhatsApp ...
        }
        
        function obtenerCoordenadas(e) {
            // ... misma función que en WhatsApp ...
        }
        
        function comenzarDibujo(e) {
            // ... misma función que en WhatsApp ...
        }
        
        function dibujar(e) {
            // ... misma función que en WhatsApp ...
        }
        
        function terminarDibujo(e) {
            // ... misma función que en WhatsApp ...
        }
        
        function dibujarAnotaciones() {
            // ... misma función que en WhatsApp ...
        }
        
        function deshacerAnotacion() {
            // ... misma función que en WhatsApp ...
        }
        
        function actualizarContador() {
            // ... misma función que en WhatsApp ...
        }
        
        function finalizarAnotacion() {
            if (!puedeEditarActual) {
                alert('⚠️ No puedes guardar anotaciones en fotos de días anteriores');
                return;
            }
            
            if (anotaciones.length === 0) {
                alert('⚠️ No has marcado ningún producto. Dibuja círculos alrededor de los productos devueltos.');
                return;
            }
            
            const observaciones = prompt('Observaciones sobre la devolución (opcional):\\n\\nSe devolvieron ' + anotaciones.length + ' producto(s).', '') || '';
            
            // Guardar anotaciones
            fetch('/guardar-anotacion-telegram', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    fotoId: fotoActual,
                    anotaciones: anotaciones
                })
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    const productosDevueltos = anotaciones.map((anot, index) => ({
                        nombre: 'Producto ' + (index + 1),
                        cantidad: 1
                    }));
                    
                    marcarDevolucionParcial(fotoActual, productosDevueltos, observaciones);
                } else {
                    alert('Error guardando anotaciones: ' + result.message);
                }
            })
            .catch(error => {
                alert('Error de conexión: ' + error.message);
            });
        }
        
        function marcarDevolucionParcial(fotoId, productosDevueltos, observaciones) {
            fetch('/marcar-devolucion-telegram', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    fotoId: fotoId,
                    observaciones: observaciones,
                    usuario: 'Usuario Bodega',
                    productosDevueltos: productosDevueltos
                })
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    alert('✅ Devolución parcial registrada correctamente\\nProductos devueltos: ' + productosDevueltos.length);
                    cerrarAnotador();
                    location.reload();
                } else {
                    alert('Error: ' + result.message);
                }
            })
            .catch(error => {
                alert('Error de conexión: ' + error.message);
            });
        }
        
        function marcarDevolucionCompleta(fotoId, boton) {
            const obs = prompt('Ingresa observaciones (opcional):') || '';
            
            boton.disabled = true;
            boton.innerHTML = '⏳ Procesando...';
            
            fetch('/marcar-devolucion-telegram', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    fotoId: fotoId,
                    observaciones: obs,
                    usuario: 'Usuario Bodega',
                    productosDevueltos: []
                })
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    boton.innerHTML = '✅ Devuelto';
                    boton.classList.remove('btn-return');
                    boton.classList.add('btn-disabled');
                    setTimeout(() => location.reload(), 1500);
                } else {
                    alert('Error: ' + result.message);
                    boton.disabled = false;
                    boton.innerHTML = '🔄 Marcar como devuelto';
                }
            })
            .catch(error => {
                alert('Error de conexión: ' + error.message);
                boton.disabled = false;
                boton.innerHTML = '🔄 Marcar como devuelto';
            });
        }
        
        // Cerrar modal al hacer click fuera
        window.onclick = function(event) {
            const modal = document.getElementById('modalAnotacion');
            if (event.target === modal) {
                cerrarAnotador();
            }
        }
    </script>
</body>
</html>`;

    const htmlPath = path.join(CARPETA_HTML, `${fechaActual}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`✅ HTML Telegram generado: ${htmlPath}`);
}

/* ---------- INICIAR SISTEMA ---------- */
app.listen(PORT, () => {
    console.log(`🚀 Servidor web en http://localhost:${PORT}`);
    console.log(`📊 Panel de reportes Telegram: http://localhost:${PORT}/reportes_telegram`);
    console.log(`📊 Reporte principal: http://localhost:${PORT}/telegram`);
});

// Iniciar bot de Telegram
bot.launch()
    .then(() => {
        console.log('🤖 Bot de Telegram iniciado correctamente');
        console.log('👤 Nombre del bot:', bot.botInfo?.first_name);
        console.log('🆔 ID del bot:', bot.botInfo?.id);
        console.log('📝 Agrega el bot a los grupos y usa /groupid para obtener los IDs');
        
        // Generar reporte inicial
        generarReporteConfirmaciones();
    })
    .catch(err => {
        console.error('❌ Error iniciando bot de Telegram:', err);
    });

// Manejo de señales para cerrar correctamente
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));