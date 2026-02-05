const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'fotos_index.json');

// Leer índice
function leerIndex() {
    if (!fs.existsSync(INDEX_PATH)) {
        fs.writeFileSync(INDEX_PATH, '{}');
    }

    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}

// Guardar índice
function guardarIndex(data) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(data, null, 2));
}

// Registrar nueva foto

/*function registrarFoto(info) {
    const index = leerIndex();

    const key = `${info.chatId}_${info.messageId}`;

    index[key] = {
        archivo: info.archivo,
        usuario: info.usuario,
        grupo: info.grupo,
        fecha: info.fecha,
        estado: 'confirmado'
    };

    guardarIndex(index);
}*/
function registrarFoto(info) {
    const index = leerIndex();

    const key = `${info.chatId}_${info.messageId}`;

    index[key] = {
        archivo: info.archivo,
        usuario: info.usuario,
        grupo: info.grupo,
        fecha: info.fecha,
        estado: 'confirmado',

        // ✅ Guardar información del producto
        info: info.info || null
    };

    guardarIndex(index);
}

// Buscar por mensaje
function buscarPorMensaje(chatId, messageId) {
    const index = leerIndex();
    const key = `${chatId}_${messageId}`;

    return index[key] || null;
}

// Cambiar estado
function cambiarEstado(chatId, messageId, nuevoEstado) {
    const index = leerIndex();
    const key = `${chatId}_${messageId}`;

    if (!index[key]) return false;

    index[key].estado = nuevoEstado;
    guardarIndex(index);
    return true;
}

module.exports = {
    registrarFoto,
    buscarPorMensaje,
    cambiarEstado
};
