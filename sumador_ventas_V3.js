// sumador_ventas_v2_1.js
// Sumador de ventas DEFINITIVO (fecha local, precios reales, tallas ignoradas)

const fs = require('fs');
const path = require('path');

/* ======================================================
   FECHA LOCAL (NO UTC, NO toISOString)
====================================================== */
function obtenerFechaLocalISO() {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = String(hoy.getMonth() + 1).padStart(2, '0');
    const d = String(hoy.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/* ======================================================
   LÍNEAS QUE NO SON VENTAS
====================================================== */
function debeIgnorarLinea(linea) {
    const ignorar = [
        '[Archivo guardado',
        '[Venta - Archivo',
        '[Foto enviada]',
        '/total',
        '/status',
        '/groupid',
        '/myid',
        '/totalmes',
        '/ultimas',
        '/ayudatotal'
    ];

    return ignorar.some(txt => linea.includes(txt));
}

/* ======================================================
   EXTRAER PRECIO SEGÚN REGLAS DE NEGOCIO
====================================================== */
function extraerPrecioDeLinea(linea) {
    if (debeIgnorarLinea(linea)) return 0;

    const match = linea.match(
        /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}:\d{2}) (.+?): (.+)$/
    );

    if (!match) return 0;

    const mensaje = match[4];

    // Extraer TODOS los números del mensaje
    const numeros = mensaje.match(/\d+/g)?.map(Number) || [];

    for (const n of numeros) {
        // Precio válido
        if (n >= 50 && n <= 9000) {
            // Ignorar tallas
            if (n >= 35 && n <= 46) continue;

            console.log(`✅ Precio detectado: $${n} | "${mensaje}"`);
            return n;
        }
    }

    return 0;
}

/* ======================================================
   TOTAL DE VENTAS DEL DÍA
====================================================== */
async function calcularTotalVentas(fecha = null, grupo = 'Ventas_55') {
    try {
        if (!fecha) {
            fecha = obtenerFechaLocalISO(); // 🔥 CLAVE
        }

        const logPath = path.join(
            __dirname,
            'sistema_bodega',
            'logs',
            grupo,
            `${fecha}.txt`
        );

        if (!fs.existsSync(logPath)) {
            return {
                total: 0,
                cantidadVentas: 0,
                ventas: [],
                mensaje: `📭 No hay ventas registradas para ${fecha}`
            };
        }

        const contenido = fs.readFileSync(logPath, 'utf8');
        const lineas = contenido.split('\n').filter(Boolean);

        let total = 0;
        let cantidadVentas = 0;
        const ventas = [];

        for (const linea of lineas) {
            const precio = extraerPrecioDeLinea(linea);

            if (precio > 0) {
                total += precio;
                cantidadVentas++;

                const partes = linea.match(
                    /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}:\d{2}) (.+?): (.+)$/
                );

                if (partes) {
                    ventas.push({
                        hora: partes[2],
                        usuario: partes[3],
                        precio,
                        mensaje: partes[4]
                    });
                }
            }
        }

        const formato = new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP'
        });

        const mensaje =
            `📊 **VENTAS ${fecha}**\n\n` +
            `💰 **Total:** ${formato.format(total)}\n` +
            `📦 **Cantidad de ventas:** ${cantidadVentas}`;

        return {
            total,
            cantidadVentas,
            ventas,
            mensaje
        };

    } catch (error) {
        console.error('❌ Error calculando ventas:', error);
        return {
            total: 0,
            cantidadVentas: 0,
            ventas: [],
            mensaje: '❌ Error calculando ventas'
        };
    }
}

/* ======================================================
   ÚLTIMAS N VENTAS DEL DÍA
====================================================== */
async function obtenerUltimasVentas(limite = 10) {
    const fecha = obtenerFechaLocalISO();
    const res = await calcularTotalVentas(fecha);

    const ultimas = res.ventas.slice(-limite).reverse();

    const formato = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP'
    });

    let mensaje = `🔄 **ÚLTIMAS ${limite} VENTAS (${fecha})**\n\n`;

    if (ultimas.length === 0) {
        mensaje += '📭 No hay ventas registradas';
    } else {
        ultimas.forEach((v, i) => {
            mensaje += `${i + 1}. ⏰ ${v.hora} - 👤 ${v.usuario}\n`;
            mensaje += `   💰 ${formato.format(v.precio)}\n`;
            mensaje += `   📝 ${v.mensaje}\n\n`;
        });
    }

    return {
        ventas: ultimas,
        mensaje
    };
}

/* ======================================================
   EXPORTS
====================================================== */
module.exports = {
    calcularTotalVentas,
    obtenerUltimasVentas,
    extraerPrecioDeLinea,
    obtenerFechaLocalISO
};

console.log('✅ sumador_ventas_v2_1 cargado correctamente');
