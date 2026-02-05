const fs = require('fs');
const path = require('path');
const { buscarPorMensaje, cambiarEstado } = require('./fotos_index');

const BASE_DIR = path.join(__dirname, 'sistema_bodega');
const FOTOS_DIR = path.join(BASE_DIR, 'fotos');


let bot = null;

// Inicializar con el bot principal
function initDevoluciones(telegramBot) {
    bot = telegramBot;
}

// Verificar si usuario es admin del grupo
async function esAdmin(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(
            ctx.chat.id,
            ctx.from.id
        );

        return (
            member.status === 'administrator' ||
            member.status === 'creator'
        );
    } catch (err) {
        console.error('Error verificando admin:', err.message);
        return false;
    }
}

// Procesar comando "d"
async function procesarDevolucion(ctx) {

    try {

        // Debe ser texto
        if (!ctx.message || !ctx.message.text) return;

        // Debe ser "d"
        if (ctx.message.text.trim().toLowerCase() !== 'd') return;

        // Debe ser reply
        if (!ctx.message.reply_to_message) return;

        // Debe ser admin
        const admin = await esAdmin(ctx);
        if (!admin) {
            await ctx.reply('❌ Solo administradores pueden devolver.');
            return;
        }

        const reply = ctx.message.reply_to_message;

        // Debe responder a una foto
        if (!reply.photo) {
            await ctx.reply('❌ Debes responder a una foto.');
            return;
        }

        const chatId = ctx.chat.id;
        const msgId = reply.message_id;

        // Buscar en índice
        const info = buscarPorMensaje(chatId, msgId);

        if (!info) {
            await ctx.reply('❌ Foto no encontrada en el sistema.');
            return;
        }

        // Ya devuelta?
        if (info.estado === 'devuelto') {
            await ctx.reply('⚠️ Esta foto ya fue devuelta.');
            return;
        }

        // Cambiar estado
        cambiarEstado(chatId, msgId, 'devuelto');

        // Construir ruta física
        const fotoPath = path.join(
            FOTOS_DIR,
            info.grupo,
            info.fecha,
            info.archivo
        );
        //console.log('🔍 Buscando archivo en:', fotoPath);
        if (!fs.existsSync(fotoPath)) {
            await ctx.reply('❌ Archivo no encontrado en disco.');
            return;
        }

        // Texto para grupo devoluciones
        const fecha = new Date().toISOString().replace('T', ' ').substring(0, 19);

        //const texto = `${fecha} ${info.usuario}: [Devuelto a bodega: ${info.archivo}]`;
        const foto = info;

        let descripcion = '';

        if (foto.info?.tallas?.length) {
            descripcion += `Talla ${foto.info.tallas.join(', ')}`;
        }

        if (foto.info?.marca) {
            descripcion += descripcion
                ? ` - ${foto.info.marca}`
                : foto.info.marca;
        }

        if (foto.info?.color) {
            descripcion += descripcion
                ? ` ${foto.info.color}`
                : foto.info.color;
        }

        if (!descripcion) {
            descripcion = foto.archivo; // respaldo
        }

        const texto = `[Devuelto a bodega: ${descripcion}]`;

        // ID del grupo devoluciones (AJUSTAR)
        const GRUPO_DEVOLUCIONES = process.env.GRUPO_DEVOLUCIONES_ID;

        if (!GRUPO_DEVOLUCIONES) {
            await ctx.reply('❌ Grupo devoluciones no configurado.');
            return;
        }

        // Enviar foto
        await bot.telegram.sendPhoto(
            GRUPO_DEVOLUCIONES,
            { source: fotoPath },
            { caption: texto }
        );

        await ctx.reply('✅ Producto marcado como devuelto.');

        console.log('📦 Devuelto:', info.archivo);

    } catch (err) {
        console.error('Error devolución:', err);
        await ctx.reply('❌ Error procesando devolución.');
    }
}

module.exports = {
    initDevoluciones,
    procesarDevolucion
};
