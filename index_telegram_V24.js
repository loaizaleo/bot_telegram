// index_telegram_V20.js - SISTEMA COMPLETO DE BODEGA TELEGRAM
// Versión mejorada con: logs, reportes, fotos, confirmaciones inteligentes

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf } = require('telegraf');

// ==================== CONFIGURACIÓN ====================
const app = express();
const PORT = process.env.PORT || 3000;

// Directorios base
const BASE_DIR = path.join(__dirname, 'sistema_bodega');
const FOTOS_DIR = path.join(BASE_DIR, 'fotos');
const REPORTES_DIR = path.join(BASE_DIR, 'reportes');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

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

                        for (const archivo of archivos.slice(0, 20)) { // Limitar a 20 por grupo
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

        // Ordenar por fecha más reciente
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

        // Buscar el archivo de log más reciente
        const hoy = new Date().toISOString().split('T')[0];
        const archivosLog = [];

        // Buscar en todos los grupos
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

        // Ordenar por fecha (más reciente primero)
        archivosLog.sort((a, b) => b.archivo.localeCompare(a.archivo));

        // Leer últimas líneas del log más reciente
        if (archivosLog.length > 0) {
            const logMasReciente = archivosLog[0];
            try {
                const contenido = fs.readFileSync(logMasReciente.ruta, 'utf8');
                const lineas = contenido.split('\n').filter(l => l.trim());

                // Tomar últimas 30 líneas
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

        return logs.reverse(); // Más recientes al final para mostrar
    } catch (error) {
        console.error('❌ Error obteniendo logs:', error.message);
        return [];
    }
}

/**
 * Guarda un mensaje en el log (igual que WhatsApp)
 */
function guardarLog(grupo, usuario, mensaje, tipo = 'texto') {
    try {
        const fecha = new Date();
        const fechaStr = fecha.toISOString().split('T')[0];
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour12: false });

        // Limpiar nombre del grupo para carpeta
        const nombreGrupo = grupo.replace(/[^a-zA-Z0-9]/g, '_');
        const logDir = path.join(LOGS_DIR, nombreGrupo);

        // Crear directorio si no existe
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Ruta del archivo de log
        const logPath = path.join(logDir, `${fechaStr}.txt`);

        // Formato: "2026-01-31 14:30:00 Usuario: mensaje"
        const logEntry = `${fechaStr} ${horaStr} ${usuario}: ${mensaje}\n`;

        // Agregar al archivo
        fs.appendFileSync(logPath, logEntry, 'utf8');

        console.log(`📝 Log: ${nombreGrupo}/${fechaStr}.txt`);

    } catch (error) {
        console.error('❌ Error guardando log:', error.message);
    }
}

/**
 * Extrae información mejorada de mensajes de confirmación
 */
function extraerInformacionMejorada(mensaje) {
    const texto = mensaje.toLowerCase();

    // 1. Extraer tallas (múltiples formatos)
    let tallas = [];

    // Patrones de tallas
    const patronesTallas = [
        /talla\s+(\d{1,2}(?:\.\d)?)/gi,                    // "talla 38"
        /t\.?\s*(\d{1,2}(?:\.\d)?)/gi,                     // "t 38" o "t.38"
        /\b(\d{1,2}(?:\.\d)?)\s*(?:y|,|-|&|\/)\s*(\d{1,2}(?:\.\d)?)/gi, // "40 y 42", "40,42", "40-42"
        /\b(\d{1,2}(?:\.\d)?)\b/gi                         // cualquier número
    ];

    for (const patron of patronesTallas) {
        const matches = [...texto.matchAll(patron)];
        for (const match of matches) {
            if (match[1] && match[2]) {
                // Dos tallas (ej: "40 y 42")
                const t1 = parseFloat(match[1]);
                const t2 = parseFloat(match[2]);
                if (t1 >= 20 && t1 <= 50) tallas.push(t1.toString());
                if (t2 >= 20 && t2 <= 50) tallas.push(t2.toString());
            } else if (match[1]) {
                // Una talla
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
        /color\s+(\w+(?:\s+\w+)?)/i,                      // "color rojo"
        /\b(rojo|roja|azul|verde|amarillo|negro|blanco|gris|rosa|morado|naranja|beige|marrón|café|marron)\b/i,
        /(\w+)\s+(?:talla|t\.?|tamaño)/i,                 // "roja talla"
        /talla.*?\b(\w+)\b/i                              // "talla 38 roja"
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

    // 4. Detectar devolución
    const esDevolucion = /devuelto|devoluci[oó]n|regresa|retorna/i.test(texto);

    // 5. Detectar precio (para ventas)
    let precio = null;
    const matchPrecio = texto.match(/\$?\s*(\d{2,6}(?:\.\d{2})?)\b/);
    if (matchPrecio) {
        precio = matchPrecio[1];
    }

    return {
        tallas,
        color: color || null,
        tipoProducto: tipoProducto || null,
        esDevolucion,
        precio: precio || null,
        textoOriginal: mensaje
    };
}

/**
 * Guarda foto desde Telegram
 */
async function guardarFotoTelegram(fileId, grupoNombre, usuario) {
    try {
        console.log(`   📸 Descargando foto de ${usuario}...`);

        // Obtener información del archivo
        const file = await bot.telegram.getFile(fileId);
        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        // Descargar la imagen
        const response = await fetch(url);

        let buffer;
        if (typeof response.arrayBuffer === 'function') {
            // node-fetch v3+
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else if (typeof response.buffer === 'function') {
            // node-fetch v2
            buffer = await response.buffer();
        } else {
            // Fallback
            const text = await response.text();
            buffer = Buffer.from(text);
        }

        console.log(`   ✅ Descargado: ${buffer.length} bytes`);

        // Crear estructura de carpetas
        const fecha = new Date();
        const fechaStr = fecha.toISOString().split('T')[0];
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour12: false });

        const nombreSeguro = grupoNombre.replace(/[^a-zA-Z0-9]/g, '_');
        const carpetaGrupo = path.join(FOTOS_DIR, nombreSeguro, fechaStr);

        fs.mkdirSync(carpetaGrupo, { recursive: true });

        // Nombre del archivo
        const nombreArchivo = `${Date.now()}_${horaStr.replace(/:/g, '-')}.jpg`;
        const rutaCompleta = path.join(carpetaGrupo, nombreArchivo);

        // Guardar archivo
        fs.writeFileSync(rutaCompleta, buffer);

        console.log(`   💾 Guardado: ${nombreSeguro}/${fechaStr}/${nombreArchivo}`);

        return {
            rutaWeb: `/fotos/${nombreSeguro}/${fechaStr}/${nombreArchivo}`,
            archivo: nombreArchivo,
            grupo: nombreSeguro,
            fecha: fechaStr,
            hora: horaStr
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
        const fecha = new Date().toISOString().split('T')[0];
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
        // Asegurar que el directorio de reportes existe
        if (!fs.existsSync(REPORTES_DIR)) {
            fs.mkdirSync(REPORTES_DIR, { recursive: true });
        }

        // Obtener reportes (case insensitive)
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

// Estado en memoria
let estado = {
    pendientes: new Map(),
    confirmadas: new Map()
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

// Manejo de fotos
bot.on('photo', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'Sin nombre';
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';

    console.log(`\n📸 Foto en: ${chatTitle} por ${usuario}`);

    // Guardar log de foto recibida
    guardarLog(chatTitle, usuario, '[Foto enviada]', 'foto');

    // Determinar tipo de grupo
    let tipoGrupo = '';
    if (chatId === GRUPO_CONFIRMACION_ID) tipoGrupo = 'confirmacion';
    else if (chatId === GRUPO_VENTAS_ID) tipoGrupo = 'ventas';
    else if (chatId === GRUPO_DEVOLUCIONES_ID) tipoGrupo = 'devoluciones';
    else {
        console.log(`   ❌ Grupo no configurado: ${chatId}`);
        guardarLog(chatTitle, usuario, '[Foto ignorada - grupo no configurado]', 'error');
        return;
    }

    try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fotoInfo = await guardarFotoTelegram(photo.file_id, chatTitle, usuario);

        // Guardar log de foto guardada
        guardarLog(chatTitle, usuario, `[Foto guardada: ${fotoInfo.archivo}]`, 'foto_guardada');

        if (tipoGrupo === 'confirmacion') {
            // Para grupo de confirmaciones: marcar como pendiente
            estado.pendientes.set(photo.file_id, {
                ...fotoInfo,
                messageId: ctx.message.message_id,
                usuario: usuario,
                chatTitle: chatTitle
            });

            await ctx.reply(
                `📸 **Foto registrada para confirmación**\n\n` +
                `✅ Guardada: ${fotoInfo.archivo}\n` +
                `📏 Dimensiones: ${photo.width}x${photo.height}\n\n` +
                `📝 **Responde a este mensaje con:**\n` +
                `• "v talla 38 color azul"\n` +
                `• "va 40 y 42"\n` +
                `• "c pantalón negro"\n\n` +
                `📊 Ver en: http://localhost:${PORT}`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });

        } else if (tipoGrupo === 'ventas') {
            // Para grupo de ventas: solo confirmar recepción
            await ctx.reply(
                `✅ **Foto de venta guardada**\n` +
                `📁 ${fotoInfo.archivo}\n` +
                `💰 Puedes añadir el precio en un mensaje aparte`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });

        } else if (tipoGrupo === 'devoluciones') {
            // Para grupo de devoluciones
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
        guardarLog(chatTitle, usuario, `[Error guardando foto: ${error.message}]`, 'error');
        await ctx.reply('❌ Error guardando la foto. Intenta de nuevo.').catch(() => { });
    }
});

// Manejo de mensajes de texto
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'Privado';
    const usuario = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Usuario';
    const mensaje = ctx.message.text;

    // ✅ GUARDAR LOG DE TODOS LOS MENSAJES EN TODOS LOS GRUPOS
    guardarLog(chatTitle, usuario, mensaje, 'texto');

    console.log(`💬 ${chatTitle}: ${usuario}: ${mensaje.substring(0, 50)}...`);

    // 1. GRUPO DE CONFIRMACIONES: Procesar confirmaciones
    if (chatId === GRUPO_CONFIRMACION_ID && ctx.message.reply_to_message?.photo) {
        const texto = mensaje.toLowerCase();

        // Confirmaciones válidas (con/sin espacio)
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

                // Formatear información
                let infoCompleta = [];
                if (info.tallas.length > 0) infoCompleta.push(`📏 ${info.tallas.join(', ')}`);
                if (info.color) infoCompleta.push(`🎨 ${info.color}`);
                if (info.tipoProducto) infoCompleta.push(`👕 ${info.tipoProducto}`);
                if (info.esDevolucion) infoCompleta.push(`🔄 DEVOLUCIÓN`);

                const infoTexto = infoCompleta.length > 0 ? infoCompleta.join(' | ') : 'Sin detalles';

                // Guardar en estado
                estado.confirmadas.set(fileId, {
                    ...fotoData,
                    tallas: info.tallas,
                    color: info.color,
                    tipoProducto: info.tipoProducto,
                    esDevolucion: info.esDevolucion,
                    precio: info.precio,
                    confirmador: usuario,
                    infoExtraida: infoTexto
                });

                estado.pendientes.delete(fileId);

                // Log de confirmación
                guardarLog(chatTitle, usuario,
                    `[CONFIRMADO: ${fotoData.archivo}] ${infoTexto}`,
                    'confirmacion'
                );

                // Responder al usuario
                let respuesta = `✅ **CONFIRMADO CORRECTAMENTE**\n\n`;
                respuesta += `📁 Archivo: ${fotoData.archivo}\n`;
                respuesta += `👤 Confirmado por: ${usuario}\n\n`;

                if (info.tallas.length > 0) {
                    respuesta += `📏 Talla${info.tallas.length > 1 ? 's' : ''}: ${info.tallas.join(', ')}\n`;
                }
                if (info.color) respuesta += `🎨 Color: ${info.color}\n`;
                if (info.tipoProducto) respuesta += `👕 Tipo: ${info.tipoProducto}\n`;
                if (info.esDevolucion) respuesta += `🔄 **ES UNA DEVOLUCIÓN**\n`;
                if (info.precio) respuesta += `💰 Precio: $${info.precio}\n`;

                respuesta += `\n📊 Ver reporte: http://localhost:${PORT}`;

                await ctx.reply(respuesta, { parse_mode: 'Markdown' }).catch(() => { });

                generarReporteHTML();
            }
        }
    }

    // 2. GRUPO DE VENTAS: Detectar precios
    else if (chatId === GRUPO_VENTAS_ID) {
        // Detectar precios en el mensaje
        const matchPrecio = mensaje.match(/\$?\s*(\d{2,6}(?:\.\d{2})?)\b/);
        if (matchPrecio) {
            const precio = matchPrecio[1];
            guardarLog(chatTitle, usuario, `💰 PRECIO: $${precio} - ${mensaje}`, 'venta_precio');

            // Si es reply a una foto, asociar precio con foto
            if (ctx.message.reply_to_message?.photo) {
                guardarLog(chatTitle, usuario, `📸 Foto con precio: $${precio}`, 'venta_foto_precio');
            }
        }
    }

    // 3. GRUPO DE DEVOLUCIONES: Detectar devoluciones
    else if (chatId === GRUPO_DEVOLUCIONES_ID) {
        const esDevolucion = /devuelto|devoluci[oó]n|regresa|retorna|mal estado|defectuoso/i.test(mensaje);
        if (esDevolucion) {
            guardarLog(chatTitle, usuario, `🔄 DEVOLUCIÓN: ${mensaje}`, 'devolucion');
        }
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

        // 1. Iniciar servidor web
        app.listen(PORT, () => {
            console.log(`🌐 SERVIDOR WEB: http://localhost:${PORT}`);
            console.log(`📊 REPORTES: http://localhost:${PORT}/reportes/`);
            console.log(`🖼️ FOTOS: http://localhost:${PORT}/fotos/`);
            console.log(`📝 LOGS: http://localhost:${PORT}/logs/`);
        });

        // 2. Iniciar bot de Telegram
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

        // 3. Mostrar configuración
        console.log('\n📊 CONFIGURACIÓN DE GRUPOS:');
        console.log(`   ✅ Entra/sale-bodega 55: ${GRUPO_CONFIRMACION_ID || '❌ No configurado'}`);
        console.log(`   ✅ Ventas 55: ${GRUPO_VENTAS_ID || '❌ No configurado'}`);
        console.log(`   ✅ Devoluciones bodega: ${GRUPO_DEVOLUCIONES_ID || '❌ No configurado'}`);

        // 4. Estado inicial
        console.log('\n📈 ESTADO INICIAL:');
        console.log(`   • Fotos pendientes: ${estado.pendientes.size}`);
        console.log(`   • Fotos confirmadas: ${estado.confirmadas.size}`);

        // 5. Generar reporte inicial
        generarReporteHTML();

        // 6. Log de inicio
        guardarLog('SISTEMA', 'Bot', 'Sistema iniciado correctamente', 'inicio');

        console.log('\n══════════════════════════════════════════════════════════');
        console.log('🎉 SISTEMA COMPLETAMENTE OPERATIVO 🎉');
        console.log('══════════════════════════════════════════════════════════\n');

        console.log('📝 **INSTRUCCIONES DE USO:**');
        console.log('   1. 📸 Envía foto en "Entra/sale-bodega 55"');
        console.log('   2. 💬 Responde a la foto con: "v talla 38 color azul"');
        console.log('   3. 💰 En "Ventas 55": envía foto y precio (ej: "110")');
        console.log('   4. 🔄 En "Devoluciones": envía foto y motivo');
        console.log('   5. 🌐 Revisa: http://localhost:3000');

        console.log('\n📍 **ACCESOS RÁPIDOS:**');
        console.log(`   • Panel principal: http://localhost:${PORT}`);
        console.log(`   • Reportes diarios: http://localhost:${PORT}/reportes/`);
        console.log(`   • Fotos guardadas: http://localhost:${PORT}/fotos/`);
        console.log(`   • Logs actividad: http://localhost:${PORT}/logs/`);

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