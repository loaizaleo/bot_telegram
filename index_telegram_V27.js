// index_telegram_V27.js - SISTEMA COMPLETO DE BODEGA TELEGRAM
// Versión mejorada con: logs, reportes, fotos, confirmaciones inteligentes
// MODIFICADO: Manejo correcto de precios en captions y mensajes SIN DUPLICADOS
// INCLUYE: Procesamiento de captions en grupo Entra/sale-bodega con marcas, tallas, colores

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf } = require('telegraf');
const { registrarFoto } = require('./fotos_index');

const {initDevoluciones, procesarDevolucion } = require('./devoluciones');



// ==================== CONFIGURACIÓN ====================
const app = express();
const PORT = process.env.PORT || 3000;

// Directorios base
const BASE_DIR = path.join(__dirname, 'sistema_bodega');
const FOTOS_DIR = path.join(BASE_DIR, 'fotos');
const REPORTES_DIR = path.join(BASE_DIR, 'reportes');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

//MODULO SUMADOR DE VENTAS
const sumadorVentas = require('./sumador_ventas_V3.js');

// Crear todos los directorios necesarios
[FOTOS_DIR, REPORTES_DIR, LOGS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Creado: ${path.relative(__dirname, dir)}`);
    }
});

// Servir archivos estáticos
app.use(express.static(BASE_DIR));

// Configuración del bot desde .env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GRUPO_CONFIRMACION_ID = process.env.GRUPO_CONFIRMACION_ID;
const GRUPO_VENTAS_ID = process.env.GRUPO_VENTAS_ID;
const GRUPO_DEVOLUCIONES_ID = process.env.GRUPO_DEVOLUCIONES_ID;

// Validar configuración
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('TU_TOKEN')) {
    console.error('❌ ERROR: Token de Telegram no configurado en .env');
    process.exit(1);
}

console.log('🚀 Sistema de Bodega Telegram - Iniciando...\n');

// ==================== FUNCIONES AUXILIARES ====================

/**
 * Extrae precio de un texto (caption o mensaje)
 */
function obtenerFechaLocalISO() {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = String(hoy.getMonth() + 1).padStart(2, '0');
    const d = String(hoy.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function extraerPrecio(texto) {
    if (!texto || typeof texto !== 'string') return null;

    // Patrones para extraer precio (similares a WhatsApp)
    const patrones = [
        /\$?\s*(\d{2,5}(?:\.\d{2})?)\b/,                    // $120, 120 (número principal)
        /(\d{2,5})\s*(?:nequi|daviplata|efectivo|transferencia|pago|vendido)/i,
        /precio\s*:?\s*\$?\s*(\d{2,5})/i,
        /venta\s*:?\s*\$?\s*(\d{2,5})/i,
        /valor\s*:?\s*\$?\s*(\d{2,5})/i,
        /cobr[oó]\s*:?\s*\$?\s*(\d{2,5})/i,
        /total\s*:?\s*\$?\s*(\d{2,5})/i
    ];

    for (const patron of patrones) {
        const match = texto.match(patron);
        if (match && match[1]) {
            const precioNumero = match[1];
            const precio = parseFloat(precioNumero);
            if (precio >= 50 && precio <= 9000) {
                return precioNumero;
            }
        }
    }

    return null;
}

/**
 * Determina si un mensaje es SOLO un precio
 */
function esSoloPrecio(texto) {
    if (!texto) return false;

    const textoLimpio = texto.trim();

    // Casos donde es solo un número
    if (/^\$?\s*\d{2,5}\s*$/.test(textoLimpio)) {
        return true;
    }

    // Casos como "110", "$120", " 130 ", etc.
    const soloNumero = textoLimpio.replace(/[^\d]/g, '');
    if (soloNumero.length >= 2 && soloNumero.length <= 5) {
        const textoOriginalSinEspacios = textoLimpio.replace(/\s+/g, '');
        const soloNumeroConSignoPesos = soloNumero + '$';
        const soloSignoPesosNumero = '$' + soloNumero;

        if (textoOriginalSinEspacios === soloNumero ||
            textoOriginalSinEspacios === soloNumeroConSignoPesos ||
            textoOriginalSinEspacios === soloSignoPesosNumero) {
            return true;
        }
    }

    return false;
}

/**
 * Extrae información mejorada de mensajes de confirmación (INCLUYENDO MARCAS)
 */
function extraerInformacionMejorada(mensaje) {
    const texto = mensaje.toLowerCase();

    // 1. Extraer tallas (múltiples formatos)
    let tallas = [];

    const patronesTallas = [
        /talla\s+(\d{1,2}(?:\.\d)?)/gi,
        /t\.?\s*(\d{1,2}(?:\.\d)?)/gi,
        /\b(\d{1,2}(?:\.\d)?)\s*(?:y|,|-|&|\/)\s*(\d{1,2}(?:\.\d)?)/gi,
        /\b(\d{1,2}(?:\.\d)?)\b/gi
    ];

    for (const patron of patronesTallas) {
        const matches = [...texto.matchAll(patron)];
        for (const match of matches) {
            if (match[1] && match[2]) {
                const t1 = parseFloat(match[1]);
                const t2 = parseFloat(match[2]);
                if (t1 >= 20 && t1 <= 50) tallas.push(t1.toString());
                if (t2 >= 20 && t2 <= 50) tallas.push(t2.toString());
            } else if (match[1]) {
                const t = parseFloat(match[1]);
                if (t >= 20 && t <= 50) tallas.push(t.toString());
            }
        }
    }

    // Eliminar duplicados y ordenar
    tallas = [...new Set(tallas)].sort((a, b) => parseFloat(a) - parseFloat(b));

    // 2. Extraer color
    let color = null;
    const patronesColor = [
        /color\s+(\w+(?:\s+\w+)?)/i,
        /\b(rojo|roja|azul|verde|amarillo|negro|blanco|gris|rosa|morado|naranja|beige|marrón|café|marron)\b/i,
        /(\w+)\s+(?:talla|t\.?|tamaño)/i,
        /talla.*?\b(\w+)\b/i
    ];

    for (const patron of patronesColor) {
        const match = texto.match(patron);
        if (match && match[1]) {
            color = match[1].trim();
            break;
        }
    }

    // 3. Extraer tipo de producto
    let tipoProducto = null;
    const tipos = ['pantalon', 'pantalón', 'jean', 'blusa', 'camisa', 'camiseta', 'short', 'bermuda', 'falda', 'vestido', 'chaqueta'];
    for (const tipo of tipos) {
        if (texto.includes(tipo)) {
            tipoProducto = tipo;
            break;
        }
    }

    // 4. Extraer marcas
    let marca = null;
    const marcas = ['nike', 'adidas', 'new balance', 'reebok', 'puma', 'converse', 'vans', 'jordan', 'under armour'];
    for (const marcaItem of marcas) {
        if (texto.includes(marcaItem)) {
            marca = marcaItem;
            break;
        }
    }

    // 5. Detectar devolución
    const esDevolucion = /devuelto|devoluci[oó]n|regresa|retorna/i.test(texto);

    // 6. Detectar precio (para ventas)
    let precio = null;
    const matchPrecio = texto.match(/\$?\s*(\d{2,5})\b/);
    if (matchPrecio) {
        precio = matchPrecio[1];
    }

    return {
        tallas,
        color: color || null,
        tipoProducto: tipoProducto || null,
        marca: marca || null,
        esDevolucion,
        precio: precio || null,
        textoOriginal: mensaje
    };
}

/**
 * Obtiene lista de fotos guardadas
 */
function obtenerListaFotos() {
    try {
        const fotos = [];

        if (!fs.existsSync(FOTOS_DIR)) {
            return [];
        }

        const grupos = fs.readdirSync(FOTOS_DIR);

        for (const grupo of grupos) {
            const grupoPath = path.join(FOTOS_DIR, grupo);

            try {
                if (!fs.statSync(grupoPath).isDirectory()) {
                    continue;
                }

                const fechas = fs.readdirSync(grupoPath);

                for (const fecha of fechas) {
                    const fechaPath = path.join(grupoPath, fecha);

                    try {
                        if (!fs.statSync(fechaPath).isDirectory()) {
                            continue;
                        }

                        const archivos = fs.readdirSync(fechaPath).filter(f => {
                            const ext = path.extname(f).toLowerCase();
                            return ['.jpg', '.jpeg', '.png'].includes(ext);
                        });

                        for (const archivo of archivos.slice(0, 20)) {
                            fotos.push({
                                grupo,
                                fecha,
                                archivo,
                                rutaWeb: `/fotos/${grupo}/${fecha}/${archivo}`,
                                timestamp: parseInt(archivo.split('_')[0]) || 0
                            });
                        }
                    } catch (err) {
                        console.warn(`⚠️ Error accediendo ${fechaPath}:`, err.message);
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Error accediendo ${grupoPath}:`, err.message);
            }
        }

        return fotos.sort((a, b) => b.timestamp - a.timestamp);

    } catch (error) {
        console.error('❌ Error obteniendo fotos:', error.message);
        return [];
    }
}

/**
 * Obtiene lista de logs recientes
 */
function obtenerListaLogs() {
    try {
        const logs = [];

        if (!fs.existsSync(LOGS_DIR)) {
            return [];
        }

        const hoy = obtenerFechaLocalISO();
        const archivosLog = [];

        const grupos = fs.readdirSync(LOGS_DIR);

        for (const grupo of grupos) {
            const grupoPath = path.join(LOGS_DIR, grupo);

            if (fs.statSync(grupoPath).isDirectory()) {
                const archivos = fs.readdirSync(grupoPath)
                    .filter(f => f.endsWith('.txt'))
                    .map(f => ({ grupo, archivo: f, ruta: path.join(grupoPath, f) }));

                archivosLog.push(...archivos);
            }
        }

        archivosLog.sort((a, b) => b.archivo.localeCompare(a.archivo));

        if (archivosLog.length > 0) {
            const logMasReciente = archivosLog[0];
            try {
                const contenido = fs.readFileSync(logMasReciente.ruta, 'utf8');
                const lineas = contenido.split('\n').filter(l => l.trim());

                lineas.slice(-30).forEach(linea => {
                    const partes = linea.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (.+?): (.+)$/);
                    if (partes) {
                        logs.push({
                            fecha: partes[1],
                            hora: partes[2],
                            usuario: partes[3],
                            mensaje: partes[4],
                            grupo: logMasReciente.grupo
                        });
                    }
                });
            } catch (err) {
                console.warn(`⚠️ Error leyendo log ${logMasReciente.ruta}:`, err.message);
            }
        }

        return logs.reverse();
    } catch (error) {
        console.error('❌ Error obteniendo logs:', error.message);
        return [];
    }
}

/**
 * Guarda un mensaje en el log (formato limpio sin duplicados)
 */
function guardarLog(grupo, usuario, mensaje, tipo = 'texto', esPrecio = false) {
    try {
        const fecha = new Date();
        const fechaStr = obtenerFechaLocalISO();
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour12: false });

        const nombreGrupo = grupo.replace(/[^a-zA-Z0-9]/g, '_');
        const logDir = path.join(LOGS_DIR, nombreGrupo);

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logPath = path.join(logDir, `${fechaStr}.txt`);

        let mensajeParaLog = mensaje;

        if (esPrecio) {
            const precioExtraido = extraerPrecio(mensaje);
            if (precioExtraido) {
                mensajeParaLog = `$ ${precioExtraido}`;
            }
        }

        const logEntry = `${fechaStr} ${horaStr} ${usuario}: ${mensajeParaLog}\n`;

        fs.appendFileSync(logPath, logEntry, 'utf8');

        console.log(`📝 Log: ${nombreGrupo}/${fechaStr}.txt - ${mensajeParaLog}`);

    } catch (error) {
        console.error('❌ Error guardando log:', error.message);
    }
}


// * Guarda foto desde Telegram con caption
async function guardarFotoTelegram(ctx, fileId, grupoNombre, usuario, caption = null, infoCaption = null) {
//async function guardarFotoTelegram(ctx, fileId, grupoNombre, usuario, caption = null) {
    try {
        console.log(`   📸 Descargando foto de ${usuario}...`);
        if (caption) {
            console.log(`   📝 Caption: ${caption}`);
        }

        const file = await bot.telegram.getFile(fileId);
        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const response = await fetch(url);

        let buffer;
        if (typeof response.arrayBuffer === 'function') {
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else if (typeof response.buffer === 'function') {
            buffer = await response.buffer();
        } else {
            const text = await response.text();
            buffer = Buffer.from(text);
        }

        console.log(`   ✅ Descargado: ${buffer.length} bytes`);

        const fecha = new Date();
        const fechaStr = obtenerFechaLocalISO();
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour12: false });

        const nombreSeguro = grupoNombre.replace(/[^a-zA-Z0-9]/g, '_');
        const carpetaGrupo = path.join(FOTOS_DIR, nombreSeguro, fechaStr);

        fs.mkdirSync(carpetaGrupo, { recursive: true });

        const timestamp = Date.now();
        //const nombreArchivo = `${timestamp}_${horaStr.replace(/:/g, '-')}.jpg`;
        const nombreArchivo = `${timestamp}.jpg`;
        const rutaCompleta = path.join(carpetaGrupo, nombreArchivo);

        // 💾 Guardar archivo
        fs.writeFileSync(rutaCompleta, buffer);

        registrarFoto({
            chatId: ctx.chat.id,
            messageId: ctx.message.message_id,
            archivo: nombreArchivo,
            usuario,
            grupo: nombreSeguro,
            fecha: fechaStr,

            info: {
                tallas: infoCaption?.tallas || [],
                color: infoCaption?.color || '',
                marca: infoCaption?.marca || '',
                tipo: infoCaption?.tipoProducto || ''
            }

        });


        // 📝 Registrar archivo en log (formato WhatsApp)
        guardarLog(grupoNombre, usuario, `[Archivo: ${nombreArchivo}]`, 'archivo');

        console.log(`   💾 Guardado: ${nombreSeguro}/${fechaStr}/${nombreArchivo}`);

        return {
            rutaWeb: `/fotos/${nombreSeguro}/${fechaStr}/${nombreArchivo}`,
            archivo: nombreArchivo,
            grupo: nombreSeguro,
            fecha: fechaStr,
            hora: horaStr,
            timestamp: timestamp,
            caption: caption || null
        };

    } catch (error) {
        console.error('❌ Error guardando foto:', error.message);
        throw error;
    }
}

/**
 * Genera reporte HTML diario
 */
function generarReporteHTML() {
    try {
        const fecha = obtenerFechaLocalISO();
        const fotosPendientes = Array.from(estado.pendientes.values());
        const fotosConfirmadas = Array.from(estado.confirmadas.values());

        const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Reporte Bodega - ${fecha}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
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
            border: 2px solid transparent;
            transition: transform 0.3s;
        }
        .stat-card:hover {
            transform: translateY(-5px);
        }
        .stat-number {
            font-size: 3em;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .section {
            margin: 40px 0;
            padding: 25px;
            background: #f8f9fa;
            border-radius: 15px;
        }
        .foto-container {
            margin: 20px 0;
            padding: 20px;
            border-radius: 10px;
            border: 1px solid #ddd;
        }
        .foto-container.pendiente {
            background: #fff3cd;
            border-color: #ffeaa7;
        }
        .foto-container.confirmada {
            background: #d4edda;
            border-color: #c3e6cb;
        }
        .foto-container.devolucion {
            background: #f8d7da;
            border-color: #f5c6cb;
        }
        .foto-container img {
            max-width: 300px;
            border-radius: 8px;
            margin-top: 15px;
        }
        .badge {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
            margin-right: 10px;
            margin-bottom: 10px;
        }
        .badge-pendiente { background: #ffc107; color: #856404; }
        .badge-confirmada { background: #28a745; color: white; }
        .badge-devolucion { background: #dc3545; color: white; }
        .info-item {
            display: inline-block;
            margin-right: 15px;
            margin-top: 5px;
            padding: 5px 10px;
            background: white;
            border-radius: 5px;
            font-size: 0.9em;
        }
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #6c757d;
            font-style: italic;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-top: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Reporte Bodega - ${fecha}</h1>
            <p style="color: #666;">Sistema de Gestión de Bodega - Telegram</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${fotosPendientes.length}</div>
                <div class="stat-title">Pendientes</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${fotosConfirmadas.length}</div>
                <div class="stat-title">Confirmadas</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${fotosPendientes.length + fotosConfirmadas.length}</div>
                <div class="stat-title">Total Fotos</div>
            </div>
        </div>
        
        ${fotosPendientes.length > 0 ? `
            <div class="section">
                <h2>📸 Fotos Pendientes de Confirmación (${fotosPendientes.length})</h2>
                ${fotosPendientes.map(f => `
                    <div class="foto-container pendiente">
                        <span class="badge badge-pendiente">⏳ PENDIENTE</span>
                        <p><strong>Grupo:</strong> ${f.grupo}</p>
                        <p><strong>Fecha:</strong> ${f.fecha} ${f.hora}</p>
                        <p><strong>Usuario:</strong> ${f.usuario}</p>
                        ${f.caption ? `<p><strong>Descripción:</strong> ${f.caption}</p>` : ''}
                        <img src="${f.rutaWeb}" alt="${f.archivo}" onerror="this.style.display='none'">
                    </div>
                `).join('')}
            </div>
        ` : ''}
        
        ${fotosConfirmadas.length > 0 ? `
            <div class="section">
                <h2>✅ Fotos Confirmadas (${fotosConfirmadas.length})</h2>
                ${fotosConfirmadas.map(f => `
                    <div class="foto-container confirmada ${f.esDevolucion ? 'devolucion' : ''}">
                        ${f.esDevolucion ? '<span class="badge badge-devolucion">🔄 DEVOLUCIÓN</span>' : ''}
                        <span class="badge badge-confirmada">✅ CONFIRMADA</span>
                        
                        <p><strong>Grupo:</strong> ${f.grupo}</p>
                        <p><strong>Usuario:</strong> ${f.usuario}</p>
                        <p><strong>Confirmado por:</strong> ${f.confirmador}</p>
                        
                        ${f.tallas && f.tallas.length > 0 ? `
                            <div class="info-item">
                                <strong>📏 Talla${f.tallas.length > 1 ? 's' : ''}:</strong> 
                                ${f.tallas.map(t => `<span style="background:#e9ecef;padding:3px 8px;border-radius:4px;margin:0 2px;">${t}</span>`).join('')}
                            </div>
                        ` : ''}
                        
                        ${f.color ? `<div class="info-item"><strong>🎨 Color:</strong> ${f.color}</div>` : ''}
                        ${f.marca ? `<div class="info-item"><strong>🏷️ Marca:</strong> ${f.marca}</div>` : ''}
                        ${f.tipoProducto ? `<div class="info-item"><strong>👕 Tipo:</strong> ${f.tipoProducto}</div>` : ''}
                        ${f.precio ? `<div class="info-item"><strong>💰 Precio:</strong> $${f.precio}</div>` : ''}
                        
                        ${f.infoExtraida && f.infoExtraida !== 'Sin detalles' ?
                `<p style="margin-top:10px;"><strong>📝 Información:</strong> ${f.infoExtraida}</p>` : ''}
                        
                        <img src="${f.rutaWeb}" alt="${f.archivo}" onerror="this.style.display='none'">
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="section">
                <h2>✅ Fotos Confirmadas</h2>
                <div class="empty-state">
                    <p>No hay fotos confirmadas aún.</p>
                    <p>Envía una foto en "Entra/sale-bodega 55" y responde con la información.</p>
                </div>
            </div>
        `}
        
        <div class="timestamp">
            <p>🤖 Sistema de Bodega Telegram | Generado: ${new Date().toLocaleString('es-CO')}</p>
            <p>📊 Ver panel principal: <a href="http://localhost:${PORT}">http://localhost:${PORT}</a></p>
        </div>
    </div>
</body>
</html>`;

        const rutaReporte = path.join(REPORTES_DIR, `${fecha}.html`);
        fs.writeFileSync(rutaReporte, html, 'utf8');
        console.log(`📄 Reporte generado: /reportes/${fecha}.html`);

    } catch (error) {
        console.error('❌ Error generando reporte:', error.message);
    }
}

// ==================== PÁGINAS WEB ====================

/**
 * Página principal
 */
app.get('/', (req, res) => {
    try {
        if (!fs.existsSync(REPORTES_DIR)) {
            fs.mkdirSync(REPORTES_DIR, { recursive: true });
        }

        const reportes = fs.readdirSync(REPORTES_DIR)
            .filter(f => f.toLowerCase().endsWith('.html'))
            .sort()
            .reverse();

        const fotos = obtenerListaFotos();
        const logs = obtenerListaLogs();

        const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Sistema Bodega Telegram</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
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
            border: 2px solid #f0f0f0;
            transition: transform 0.3s;
        }
        .stat-card:hover {
            transform: translateY(-5px);
        }
        .stat-number {
            font-size: 3em;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 10px;
        }
        .section {
            margin: 40px 0;
            padding: 25px;
            background: #f8f9fa;
            border-radius: 15px;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 25px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            margin: 10px 5px;
            transition: all 0.3s;
        }
        .btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
        }
        .btn-log {
            background: #6c757d;
        }
        .photo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .photo-card {
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            transition: transform 0.3s;
        }
        .photo-card:hover {
            transform: scale(1.05);
        }
        .photo-card img {
            width: 100%;
            height: 150px;
            object-fit: cover;
        }
        .photo-info {
            padding: 15px;
            background: white;
        }
        .log-entry {
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            padding: 8px;
            border-bottom: 1px solid #eee;
            background: white;
            margin-bottom: 5px;
            border-radius: 5px;
        }
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #6c757d;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Sistema de Bodega Telegram</h1>
            <p style="color: #666; margin-top: 10px;">Sistema activo - ${new Date().toLocaleString('es-CO')}</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${reportes.length}</div>
                <div class="stat-title">Reportes</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${fotos.length}</div>
                <div class="stat-title">Fotos</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${logs.length}</div>
                <div class="stat-title">Logs Hoy</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">3</div>
                <div class="stat-title">Grupos</div>
            </div>
        </div>
        
        <div class="section">
            <h2>📋 Reportes Disponibles</h2>
            ${reportes.length > 0 ?
                reportes.map(r => `
                    <a href="/reportes/${r}" class="btn" target="_blank">
                        📄 ${r.replace('.html', '')}
                    </a>
                `).join('')
                : '<p class="empty-state">No hay reportes generados aún. Envía fotos para generar reportes.</p>'
            }
        </div>
        
        <div class="section">
            <h2>📝 Últimas Actividades</h2>
            ${logs.length > 0 ? `
                <div style="background: white; padding: 15px; border-radius: 10px; max-height: 400px; overflow-y: auto;">
                    ${logs.map(log => `
                        <div class="log-entry">
                            <strong>${log.grupo}</strong> | ${log.fecha} ${log.hora}<br>
                            <strong>${log.usuario}:</strong> ${log.mensaje}
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top: 15px;">
                    <a href="/logs/" class="btn btn-log">📁 Ver todos los logs</a>
                </p>
            ` : '<p class="empty-state">No hay actividades registradas aún.</p>'}
        </div>
        
        <div class="section">
            <h2>🖼️ Últimas Fotos (${fotos.length})</h2>
            ${fotos.length > 0 ? `
                <div class="photo-grid">
                    ${fotos.slice(0, 12).map(f => `
                        <div class="photo-card">
                            <img src="${f.rutaWeb}" alt="${f.archivo}" 
                                 onerror="this.src='https://via.placeholder.com/200x150?text=Imagen+no+disponible'">
                            <div class="photo-info">
                                <p><strong>${f.grupo}</strong></p>
                                <p>${f.fecha}</p>
                                <p>${f.archivo.substring(0, 15)}...</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top: 20px;">
                    <a href="/fotos/" class="btn">📁 Ver todas las fotos</a>
                </p>
            ` : '<p class="empty-state">No hay fotos guardadas aún. Envía fotos en los grupos de Telegram.</p>'}
        </div>
        
        <div style="text-align: center; margin-top: 40px; color: #666; padding-top: 20px; border-top: 1px solid #eee;">
            <p>🤖 Bot: @Local_55_bot | 🌐 Sistema activo desde: ${new Date().toLocaleString('es-CO')}</p>
            <p>📍 Grupos: Entra/sale-bodega 55 • Ventas 55 • Devoluciones bodega</p>
        </div>
    </div>
</body>
</html>`;

        res.send(html);

    } catch (error) {
        console.error('❌ Error cargando página principal:', error);
        res.status(500).send('<h1>Error interno del servidor</h1><p>Revisa la consola para más detalles.</p>');
    }
});

// ==================== BOT DE TELEGRAM ====================

// Crear instancia del bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
initDevoluciones(bot);

// Estado en memoria
let estado = {
    pendientes: new Map(),
    confirmadas: new Map(),
    ultimoPrecioFoto: new Map()
};

// Manejo de errores global
bot.catch((err, ctx) => {
    console.error(`❌ Error en ${ctx?.updateType || 'desconocido'}:`, err.message);
});

// Comando: /status
bot.command('status', async (ctx) => {
    const usuario = ctx.from.first_name || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/status', 'comando');

    await ctx.reply(
        `📊 **ESTADO DEL SISTEMA**\n` +
        `🤖 Bot: @Local_55_bot\n` +
        `🌐 Panel web: http://localhost:${PORT}\n` +
        `📸 Fotos pendientes: ${estado.pendientes.size}\n` +
        `✅ Fotos confirmadas: ${estado.confirmadas.size}\n` +
        `📝 Logs activos: Sí\n` +
        `📍 Grupos configurados: 3`,
        { parse_mode: 'Markdown' }
    ).catch(() => { });
});

// Comando: /groupid
bot.command('groupid', async (ctx) => {
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/groupid', 'comando');

    await ctx.reply(
        `🆔 **ID de este chat:**\n\`${ctx.chat.id}\`\n\n` +
        `📝 **Nombre:** ${grupo}\n` +
        `👥 **Tipo:** ${ctx.chat.type}`,
        { parse_mode: 'Markdown' }
    ).catch(() => { });
});

// Comando: /myid
bot.command('myid', async (ctx) => {
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/myid', 'comando');

    await ctx.reply(
        `👤 **Tu información:**\n` +
        `• ID: \`${ctx.from.id}\`\n` +
        `• Nombre: ${usuario}\n` +
        `• Username: ${ctx.from.username ? '@' + ctx.from.username : 'No tiene'}`,
        { parse_mode: 'Markdown' }
    ).catch(() => { });
});
//Comando TOTAL
// Comando: /total - Total de ventas (hoy o fecha específica)
bot.command('total', async (ctx) => {
    const usuario = ctx.from.first_name || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/total', 'comando');

    try {
        // Extraer parámetros del mensaje
        const texto = ctx.message.text.split(' ');
        let fechaParam = null;

        // Verificar si se proporcionó una fecha
        if (texto.length > 1) {
            const posibleFecha = texto[1];

            // Validar formato de fecha (YYYY-MM-DD)
            const regexFecha = /^\d{4}-\d{2}-\d{2}$/;
            if (regexFecha.test(posibleFecha)) {
                fechaParam = posibleFecha;

                // Validar que sea una fecha válida
                const fechaObj = new Date(posibleFecha + 'T00:00:00');
                if (isNaN(fechaObj.getTime())) {
                    await ctx.reply(
                        '❌ **Fecha inválida**\n\n' +
                        'Usa formato: `/total 2026-02-03`\n' +
                        'Ejemplos:\n' +
                        '• `/total` (ventas de hoy)\n' +
                        '• `/total 2026-02-03` (ventas del 3 de febrero)\n' +
                        '• `/total 2026-01-31` (ventas del 31 de enero)',
                        { parse_mode: 'Markdown' }
                    ).catch(() => { });
                    return;
                }
            } else {
                await ctx.reply(
                    '❌ **Formato de fecha incorrecto**\n\n' +
                    'Usa formato: `/total AAAA-MM-DD`\n' +
                    'Ejemplo: `/total 2026-02-03`',
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
                return;
            }
        }

        // Determinar mensaje según si hay fecha específica
        let mensajeProcesandoTexto = '🔄 Calculando total de ventas...';
        if (fechaParam) {
            mensajeProcesandoTexto = `🔄 Calculando ventas del ${fechaParam}...`;
        }

        const mensajeProcesando = await ctx.reply(mensajeProcesandoTexto, {
            parse_mode: 'Markdown'
        }).catch(() => null);

        // Calcular total (con o sin fecha específica)
        const resultado = await sumadorVentas.calcularTotalVentas(fechaParam);

        // Responder con el resultado
        await ctx.reply(resultado.mensaje, {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        }).catch(() => { });

        // Eliminar mensaje de "procesando" si existe
        if (mensajeProcesando) {
            setTimeout(async () => {
                try {
                    await ctx.deleteMessage(mensajeProcesando.message_id);
                } catch (e) { }
            }, 2000);
        }

    } catch (error) {
        console.error('❌ Error en comando /total:', error);
        await ctx.reply(
            '❌ Error calculando total de ventas. Verifica los logs.',
            { parse_mode: 'Markdown' }
        ).catch(() => { });
    }
});

// Comando: /totalmes - Total del mes (actual o AAAA-MM)
bot.command('totalmes', async (ctx) => {
    const usuario = ctx.from.first_name || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/totalmes', 'comando');

    try {
        const texto = ctx.message.text.split(' ');
        let mesParam = null;

        if (texto.length > 1) {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(texto[1])) {
                await ctx.reply(
                    '❌ **Formato de mes incorrecto**\n\n' +
                    'Usa formato: `/totalmes AAAA-MM`\n' +
                    'Ejemplo: `/totalmes 2026-02`',
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
                return;
            }
            mesParam = texto[1];
        }

        const resultado = await sumadorVentas.calcularTotalMes(mesParam);

        await ctx.reply(resultado.mensaje, {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        }).catch(() => { });

    } catch (error) {
        console.error('❌ Error en comando /totalmes:', error);
        await ctx.reply('❌ Error calculando el total del mes. Verifica los logs.').catch(() => { });
    }
});

// Comando: /ultimas [n] - Últimas n ventas del día
bot.command('ultimas', async (ctx) => {
    const usuario = ctx.from.first_name || ctx.from.username || 'Usuario';
    const grupo = ctx.chat.title || 'Chat privado';

    guardarLog(grupo, usuario, '/ultimas', 'comando');

    try {
        const texto = ctx.message.text.split(' ');
        let limite = 10;

        if (texto.length > 1) {
            const n = parseInt(texto[1], 10);
            if (isNaN(n) || n < 1 || n > 50) {
                await ctx.reply(
                    '❌ Indica un número entre 1 y 50.\nEjemplo: `/ultimas 5`',
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
                return;
            }
            limite = n;
        }

        const resultado = await sumadorVentas.obtenerUltimasVentas(limite);

        await ctx.reply(resultado.mensaje, {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        }).catch(() => { });

    } catch (error) {
        console.error('❌ Error en comando /ultimas:', error);
        await ctx.reply('❌ Error obteniendo las últimas ventas. Verifica los logs.').catch(() => { });
    }
});

// Comando: /ayudatotal - Ayuda sobre el comando total
bot.command('ayudatotal', async (ctx) => {
    await ctx.reply(
        '📋 **AYUDA - COMANDO /total**\n\n' +
        '**Sintaxis:**\n' +
        '• `/total` - Ventas de hoy\n' +
        '• `/total AAAA-MM-DD` - Ventas de fecha específica\n\n' +
        '**Ejemplos:**\n' +
        '• `/total` → Ventas del día actual\n' +
        '• `/total 2026-02-03` → Ventas del 3 de febrero 2026\n' +
        '• `/total 2026-01-31` → Ventas del 31 de enero 2026\n\n' +
        '**Otros comandos relacionados:**\n' +
        '• `/totalmes` - Total del mes actual\n' +
        '• `/totalmes 2026-02` - Total de un mes específico\n' +
        '• `/ultimas 5` - Últimas 5 ventas',
        { parse_mode: 'Markdown' }
    ).catch(() => { });
});

// Manejo de fotos CON CAPTION
bot.on('photo', async (ctx) => {
    let infoCaption = null;
    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'Sin nombre';
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';
    const caption = ctx.message.caption || '';

    console.log(`\n📸 Foto en: ${chatTitle} por ${usuario}`);
    if (caption) {
        console.log(`   📝 Caption: ${caption}`);
    }

    let tipoGrupo = '';
    if (chatId === GRUPO_CONFIRMACION_ID) tipoGrupo = 'confirmacion';
    else if (chatId === GRUPO_VENTAS_ID) tipoGrupo = 'ventas';
    else if (chatId === GRUPO_DEVOLUCIONES_ID) tipoGrupo = 'devoluciones';
    else {
        console.log(`   ❌ Grupo no configurado: ${chatId}`);
        return;
    }

    try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;

        // 🔹 Guardar precio ANTES (solo ventas)
        if (tipoGrupo === 'ventas' && caption) {
            const match = caption.match(/\b(\d{2,4})\b/);
            if (match) {
                const precio = parseInt(match[1], 10);
                if (precio >= 50 && precio <= 9000) {
                    guardarLog(chatTitle, usuario, precio.toString(), 'venta');
                }
            }
        }

        if (caption) {
            infoCaption = extraerInformacionMejorada(caption);
        }

        const fotoInfo = await guardarFotoTelegram(ctx, fileId, chatTitle, usuario, caption, infoCaption);
        
        if (tipoGrupo !== 'ventas') {
            if (caption) {
                guardarLog(chatTitle, usuario, caption, 'foto');
            } else {
                guardarLog(chatTitle, usuario, '[Foto enviada: ${nombre}]', 'foto');
            }
        }


        if (tipoGrupo === 'confirmacion') {
            estado.pendientes.set(fileId, {
                ...fotoInfo,
                messageId: ctx.message.message_id,
                usuario: usuario,
                chatTitle: chatTitle
            });

            //let infoCaption = null;
            if (caption) {
                console.log(`   📝 Caption en confirmación: ${caption}`);
                infoCaption = extraerInformacionMejorada(caption);

                if (infoCaption.tallas.length > 0 || infoCaption.color || infoCaption.tipoProducto || infoCaption.marca) {
                    estado.pendientes.get(fileId).infoCaption = infoCaption;

                    await ctx.reply(
                        `📸 *Foto por confirmar*\n\n` /*+
                        `✅ Guardada: ${fotoInfo.archivo}\n` +
                        `📏 Dimensiones: ${photo.width}x${photo.height}\n\n` +
                        `📝 **Información detectada en descripción:**\n` +
                        `${infoCaption.tallas.length > 0 ? `• Talla${infoCaption.tallas.length > 1 ? 's' : ''}: ${infoCaption.tallas.join(', ')}\n` : ''}` +
                        `${infoCaption.color ? `• Color: ${infoCaption.color}\n` : ''}` +
                        `${infoCaption.marca ? `• Marca: ${infoCaption.marca}\n` : ''}` +
                        `${infoCaption.tipoProducto ? `• Tipo: ${infoCaption.tipoProducto}\n` : ''}` +
                        `\n💡 **Puedes confirmar respondiendo con:**\n` +
                        `• "v" para confirmar\n` +
                        `• "v talla 38" para añadir/modificar\n` +
                        `• "va nike verde" para especificar marca/color\n\n` +
                        `📊 Ver en: http://localhost:${PORT}`,
                        { parse_mode: 'Markdown' }*/
                    ).catch(() => { });
                } else {
                    await ctx.reply(
                        `📸 *Foto por confirmar*\n\n`/* +
                        `✅ Guardada: ${fotoInfo.archivo}\n` +
                        `📏 Dimensiones: ${photo.width}x${photo.height}\n\n` +
                        `📝 **Descripción:** ${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}\n\n` +
                        `📝 **Responde a este mensaje con:**\n` +
                        `• "v talla 38 color azul"\n` +
                        `• "va 40 y 42"\n` +
                        `• "c pantalón negro"\n\n` +
                        `📊 Ver en: http://localhost:${PORT}`,
                        { parse_mode: 'Markdown' }*/
                    ).catch(() => { });
                }
            } else {
                await ctx.reply(
                    `📸 *Foto por confirmar*\n\n` /*+
                    `✅ Guardada: ${fotoInfo.archivo}\n` +
                    `📏 Dimensiones: ${photo.width}x${photo.height}\n\n` +
                    `📝 **Responde a este mensaje con:**\n` +
                    `• "v talla 38 color azul"\n` +
                    `• "va 40 y 42"\n` +
                    `• "c pantalón negro"\n\n` +
                    `📊 Ver en: http://localhost:${PORT}`,
                    { parse_mode: 'Markdown' }*/
                ).catch(() => { });
            }

        } else if (tipoGrupo === 'ventas') {
            let respuesta = `✅ **Foto de venta guardada**\n`;
            respuesta += `📁 ${fotoInfo.archivo}\n`;

            let precioCaption = null;
            if (caption) {
                precioCaption = extraerPrecio(caption);

                if (precioCaption) {
                    estado.ultimoPrecioFoto.set(fileId, {
                        precio: precioCaption,
                        timestamp: Date.now(),
                        usuario: usuario
                    });

                    if (!ctx.message.photo) {
                        guardarLog(chatTitle, usuario, `$ ${precioCaption}`, 'texto', true);
                    }
                    respuesta += `💰 **Precio registrado:** $${precioCaption}\n`;
                } else {
                    respuesta += `📝 Descripción: ${caption.substring(0, 50)}${caption.length > 50 ? '...' : ''}\n`;
                    respuesta += `💡 Puedes añadir el precio en un mensaje aparte\n`;
                }
            } else {
                respuesta += `📝 Puedes añadir el precio en un mensaje aparte\n`;
            }

            if (!precioCaption) {
                respuesta += `💡 Ejemplo: "120" o "$ 130"`;
            }

            await ctx.reply(respuesta, { parse_mode: 'Markdown' }).catch(() => { });

        } else if (tipoGrupo === 'devoluciones') {
            await ctx.reply(
                `🔄 **Foto de devolución guardada**\n` +
                `📁 ${fotoInfo.archivo}\n` +
                `📝 Especifica detalles en un mensaje`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });
        }

        generarReporteHTML();

    } catch (error) {
        console.error('❌ Error procesando foto:', error.message);
        await ctx.reply('❌ Error guardando la foto. Intenta de nuevo.').catch(() => { });
    }
});

// Manejo de mensajes de texto
bot.on('text', async (ctx) => {
    // 🔥 Primero: procesar devoluciones
    await procesarDevolucion(ctx);
    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'Privado';
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';
    const mensaje = ctx.message.text;

    console.log(`💬 ${chatTitle}: ${usuario}: ${mensaje.substring(0, 50)}...`);

    // 1. GRUPO DE CONFIRMACIONES: Procesar confirmaciones
    if (chatId === GRUPO_CONFIRMACION_ID && ctx.message.reply_to_message?.photo) {
        const texto = mensaje.toLowerCase();

        const confirmacionesValidas = [
            'v ', 'va ', 'c ', 'ca ', 'b ', 'ba ', 'van ', 'voy ', 'bv ', 'bc ',
            'v', 'va', 'c', 'ca', 'b', 'ba', 'van', 'voy', 'bv', 'bc'
        ];

        const esConfirmacion = confirmacionesValidas.some(conf =>
            texto.startsWith(conf) || texto === conf
        );

        if (esConfirmacion) {
            console.log(`\n✅ Confirmación detectada: "${mensaje}"`);

            const repliedPhoto = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1];
            const fileId = repliedPhoto.file_id;

            if (estado.pendientes.has(fileId)) {
                const fotoData = estado.pendientes.get(fileId);
                const info = extraerInformacionMejorada(mensaje);

                let infoCombinada = { ...info };

                if (fotoData.infoCaption) {
                    infoCombinada.tallas = info.tallas.length > 0 ? info.tallas : fotoData.infoCaption.tallas;
                    infoCombinada.color = info.color || fotoData.infoCaption.color;
                    infoCombinada.tipoProducto = info.tipoProducto || fotoData.infoCaption.tipoProducto;
                    infoCombinada.marca = info.marca || fotoData.infoCaption.marca;
                }

                let infoCompleta = [];
                if (infoCombinada.tallas.length > 0) infoCompleta.push(`📏 ${infoCombinada.tallas.join(', ')}`);
                if (infoCombinada.color) infoCompleta.push(`🎨 ${infoCombinada.color}`);
                if (infoCombinada.marca) infoCompleta.push(`🏷️ ${infoCombinada.marca}`);
                if (infoCombinada.tipoProducto) infoCompleta.push(`👕 ${infoCombinada.tipoProducto}`);
                if (infoCombinada.esDevolucion) infoCompleta.push(`🔄 DEVOLUCIÓN`);

                const infoTexto = infoCompleta.length > 0 ? infoCompleta.join(' | ') : 'Sin detalles';

                estado.confirmadas.set(fileId, {
                    ...fotoData,
                    tallas: infoCombinada.tallas,
                    color: infoCombinada.color,
                    tipoProducto: infoCombinada.tipoProducto,
                    marca: infoCombinada.marca,
                    esDevolucion: infoCombinada.esDevolucion,
                    precio: infoCombinada.precio,
                    confirmador: usuario,
                    infoExtraida: infoTexto
                });

                estado.pendientes.delete(fileId);

                guardarLog(chatTitle, usuario, `[CONFIRMADO] ${infoTexto}`, 'confirmacion');

                let respuesta = `✅ **CONFIRMADO CORRECTAMENTE**\n\n`;
                //respuesta += `📁 Archivo: ${fotoData.archivo}\n`;
                respuesta += `👤 Confirmado por: ${usuario}\n\n`;

                /*if (infoCombinada.tallas.length > 0) {
                    respuesta += `📏 Talla${infoCombinada.tallas.length > 1 ? 's' : ''}: ${infoCombinada.tallas.join(', ')}\n`;
                }
                if (infoCombinada.color) respuesta += `🎨 Color: ${infoCombinada.color}\n`;
                if (infoCombinada.marca) respuesta += `🏷️ Marca: ${infoCombinada.marca}\n`;
                if (infoCombinada.tipoProducto) respuesta += `👕 Tipo: ${infoCombinada.tipoProducto}\n`;
                if (infoCombinada.esDevolucion) respuesta += `🔄 **ES UNA DEVOLUCIÓN**\n`;
                if (infoCombinada.precio) respuesta += `💰 Precio: $${infoCombinada.precio}\n`;
                
                respuesta += `\n📊 Ver reporte: http://localhost:${PORT}`;*/

                await ctx.reply(respuesta, { parse_mode: 'Markdown' }).catch(() => { });

                generarReporteHTML();
            }
        } else {
            guardarLog(chatTitle, usuario, mensaje, 'texto');
        }
    }

    // 2. GRUPO DE VENTAS: Detectar precios SIN DUPLICAR
    else if (chatId === GRUPO_VENTAS_ID) {
        const precio = extraerPrecio(mensaje);
        const esSoloUnPrecio = esSoloPrecio(mensaje);

        if (precio && esSoloUnPrecio) {
            let esReplyAFoto = false;
            let fileIdReply = null;

            if (ctx.message.reply_to_message?.photo) {
                const repliedPhoto = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1];
                fileIdReply = repliedPhoto.file_id;
                esReplyAFoto = true;
            }

            if (esReplyAFoto && fileIdReply) {
                const precioExistente = estado.ultimoPrecioFoto.get(fileIdReply);

                if (precioExistente && Date.now() - precioExistente.timestamp < 5000) {
                    console.log(`   ⚠️  Precio duplicado ignorado para foto ${fileIdReply.substring(0, 10)}...`);
                } else {
                    guardarLog(chatTitle, usuario, `$ ${precio}`, 'texto', true);

                    estado.ultimoPrecioFoto.set(fileIdReply, {
                        precio: precio,
                        timestamp: Date.now(),
                        usuario: usuario
                    });

                    console.log(`   💰 Precio registrado: $${precio} (reply a foto)`);

                    await ctx.reply(
                        `💰 **Precio registrado:** $${precio}\n` +
                        `✅ Asociado a la foto anterior`,
                        { parse_mode: 'Markdown' }
                    ).catch(() => { });
                }
            } else {
                guardarLog(chatTitle, usuario, `$ ${precio}`, 'texto', true);
                console.log(`   💰 Precio registrado: $${precio} (sin foto)`);

                await ctx.reply(
                    `💰 **Precio registrado:** $${precio}\n` +
                    `💡 Envía una foto y responde con el precio para asociarlo`,
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
            }
        } else if (precio && !esSoloUnPrecio) {
            guardarLog(chatTitle, usuario, mensaje, 'texto');
        } else {
            guardarLog(chatTitle, usuario, mensaje, 'texto');
        }
    }

    // 3. GRUPO DE DEVOLUCIONES: Detectar devoluciones
    else if (chatId === GRUPO_DEVOLUCIONES_ID) {
        const esDevolucion = /devuelto|devoluci[oó]n|regresa|retorna|mal estado|defectuoso/i.test(mensaje);
        if (esDevolucion) {
            guardarLog(chatTitle, usuario, `🔄 ${mensaje}`, 'devolucion');
        } else {
            guardarLog(chatTitle, usuario, mensaje, 'texto');
        }
    }

    // 4. CUALQUIER OTRO GRUPO O MENSAJE
    else {
        guardarLog(chatTitle, usuario, mensaje, 'texto');
    }
});

// ==================== INICIALIZACIÓN ====================

// Polyfill para fetch
if (globalThis.fetch === undefined) {
    globalThis.fetch = require('node-fetch');
}

// Función para iniciar todo el sistema
async function iniciarSistema() {
    try {
        console.log('\n══════════════════════════════════════════════════════════');
        console.log('🚀 INICIANDO SISTEMA COMPLETO DE BODEGA TELEGRAM');
        console.log('══════════════════════════════════════════════════════════\n');

        app.listen(PORT, () => {
            console.log(`🌐 SERVIDOR WEB: http://localhost:${PORT}`);
            console.log(`📊 REPORTES: http://localhost:${PORT}/reportes/`);
            console.log(`🖼️ FOTOS: http://localhost:${PORT}/fotos/`);
            console.log(`📝 LOGS: http://localhost:${PORT}/logs/`);
        });

        console.log('\n🤖 Conectando con Telegram API...');
        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        const botInfo = bot.botInfo;
        console.log(`\n✅ BOT CONECTADO EXITOSAMENTE:`);
        console.log(`   🤖 ${botInfo.first_name} (@${botInfo.username})`);
        console.log(`   🆔 ID: ${botInfo.id}`);
        console.log(`   📖 Lee mensajes grupales: ${botInfo.can_read_all_group_messages ? '✅ Sí' : '❌ No'}`);

        console.log('\n📊 CONFIGURACIÓN DE GRUPOS:');
        console.log(`   ✅ Entra/sale-bodega 55: ${GRUPO_CONFIRMACION_ID || '❌ No configurado'}`);
        console.log(`   ✅ Ventas 55: ${GRUPO_VENTAS_ID || '❌ No configurado'}`);
        console.log(`   ✅ Devoluciones bodega: ${GRUPO_DEVOLUCIONES_ID || '❌ No configurado'}`);

        console.log('\n📈 ESTADO INICIAL:');
        console.log(`   • Fotos pendientes: ${estado.pendientes.size}`);
        console.log(`   • Fotos confirmadas: ${estado.confirmadas.size}`);

        generarReporteHTML();

        guardarLog('SISTEMA', 'Bot', 'Sistema iniciado correctamente', 'inicio');

        console.log('\n══════════════════════════════════════════════════════════');
        console.log('🎉 SISTEMA COMPLETAMENTE OPERATIVO 🎉');
        console.log('══════════════════════════════════════════════════════════\n');

        console.log('📝 **INSTRUCCIONES DE USO:**');
        console.log('   1. 📸 Envía foto en "Entra/sale-bodega 55"');
        console.log('   2. 💬 Responde a la foto con: "v talla 38 color azul"');
        console.log('   3. 💰 En "Ventas 55": envía foto con precio en caption');
        console.log('      Ejemplo: Al enviar foto, escribe "120" en la descripción');
        console.log('   4. 💰 O envía foto y luego responde con el precio');
        console.log('   5. 🔄 En "Devoluciones": envía foto y motivo');
        console.log('   6. 🌐 Revisa: http://localhost:3000');

        console.log('\n📍 **ACCESOS RÁPIDOS:**');
        console.log(`   • Panel principal: http://localhost:${PORT}`);
        console.log(`   • Reportes diarios: http://localhost:${PORT}/reportes/`);
        console.log(`   • Fotos guardadas: http://localhost:${PORT}/fotos/`);
        console.log(`   • Logs actividad: http://localhost:${PORT}/logs/`);

        console.log('💡 **COMANDOS DISPONIBLES EN TELEGRAM:**');
        console.log('   📊 Ventas: /total [fecha] | /totalmes | /ultimas [n]');
        console.log('   🤖 Sistema: /status | /groupid | /myid');
        console.log('   📝 Fecha formato: YYYY-MM-DD (ej: 2026-02-03)');
        console.log('   ❓ Ayuda: /ayudatotal');

        console.log('\n⏳ Sistema listo. Presiona Ctrl+C para salir.\n');

    } catch (error) {
        console.error('\n❌❌❌ ERROR CRÍTICO AL INICIAR ❌❌❌');
        console.error('Mensaje:', error.message);

        if (error.message.includes('401')) {
            console.error('\n💡 TOKEN DE TELEGRAM INVÁLIDO');
            console.error('   1. Verifica tu token en el archivo .env');
            console.error('   2. Obtén uno nuevo de @BotFather');
            console.error('   3. Asegúrate de no tener comillas alrededor del token');
        } else if (error.message.includes('fetch')) {
            console.error('\n💡 INSTALA node-fetch: npm install node-fetch');
        } else if (error.message.includes('ENOTFOUND')) {
            console.error('\n💡 PROBLEMA DE CONEXIÓN A INTERNET');
            console.error('   Verifica tu conexión a Internet');
        }

        process.exit(1);
    }
}

// Iniciar el sistema
iniciarSistema().catch(console.error);

// Manejo de cierre elegante
process.on('SIGINT', () => {
    console.log('\n👋 Apagando sistema...');
    guardarLog('SISTEMA', 'Bot', 'Sistema apagado correctamente', 'apagado');
    bot.stop();
    console.log('✅ Sistema apagado correctamente');
    process.exit(0);
});

process.on('SIGTERM', () => {
    bot.stop();
    process.exit(0);
});