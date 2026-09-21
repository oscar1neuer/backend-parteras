"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 1. Autenticación de Partera por PIN
app.post('/api/v1/parteras/login-pin', async (req, res) => {
    try {
        const { pin } = req.body;
        const result = await db_1.pool.query('SELECT id, nombre FROM parteras WHERE pin = $1', [pin]);
        if (result.rows.length > 0) {
            res.status(200).json({ perfil: result.rows[0], token: 'token-simulado-123' });
        }
        else {
            res.status(401).json({ error: 'PIN incorrecto' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error en el servidor al autenticar' });
    }
});
// 2. Registrar Hoja de Referencia (Envío del Formulario)
app.post('/api/v1/referencias', async (req, res) => {
    try {
        const { parteraId, centroSalud, usuaria, motivosReferencia } = req.body;
        const query = `
      INSERT INTO hojas_referencia 
      (partera_id, centro_salud, nombre_usuaria, edad, sexo, localidad_usuaria, municipio_usuaria, motivos_referencia) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `;
        const values = [
            parteraId,
            centroSalud,
            usuaria.nombre,
            usuaria.edad,
            usuaria.sexo,
            usuaria.localidad,
            usuaria.municipio,
            JSON.stringify(motivosReferencia)
        ];
        const result = await db_1.pool.query(query, values);
        res.status(201).json({ mensaje: 'Hoja de referencia guardada con éxito', referencia: result.rows[0] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al guardar la hoja de referencia' });
    }
});
// 3. Obtener Historial de Referencias (Para desplegar en el Dashboard)
app.get('/api/v1/referencias', async (_req, res) => {
    try {
        const query = `
      SELECT hr.*, c.medico_nombre, c.diagnostico, c.tratamiento, c.observaciones_partera 
      FROM hojas_referencia hr
      LEFT JOIN contrareferencias c ON hr.id = c.hoja_referencia_id
      ORDER BY hr.fecha_creacion DESC
    `;
        const result = await db_1.pool.query(query);
        res.status(200).json(result.rows);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar las referencias' });
    }
});
// 4. Responder Contrareferencia Médica
app.post('/api/v1/referencias/:id/contrareferencia', async (req, res) => {
    try {
        const { id } = req.params;
        const { medicoNombre, diagnostico, tratamiento, observacionesPartera } = req.body;
        await db_1.pool.query('INSERT INTO contrareferencias (hoja_referencia_id, medico_nombre, diagnostico, tratamiento, observaciones_partera) VALUES ($1, $2, $3, $4, $5)', [id, medicoNombre, diagnostico, tratamiento, observacionesPartera]);
        await db_1.pool.query("UPDATE hojas_referencia SET estado = 'CONTRAREFERIDO' WHERE id = $1", [id]);
        res.status(201).json({ mensaje: 'Contrareferencia guardada y estado actualizado' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al procesar la contrareferencia' });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Backend de Parteras activo en http://localhost:${PORT}`);
});
// 5. Registrar Calendario de Atención al Niño(a) (Formato Oficial No. 3 - SSO)
app.post('/api/v1/calendario-nino', async (req, res) => {
    try {
        const { parteraId, datosNino, estadoNutricional, tipoLactancia, canalizaciones, cierreAdministrativo } = req.body;
        const query = `
      INSERT INTO calendario_nino (
        partera_id, nombre_nino, edad_meses, nombre_madre, localidad, municipio,
        fecha_atencion, estado_nutricional, tipo_lactancia, canalizaciones,
        mes_informado, nombre_supervisor, centro_salud_adscripcion, huella_firmada, es_copia_centro_salud
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;
        // Maneja id de prueba (1) si el frontend envía un identificador simulado
        const idParteraValido = (typeof parteraId === 'number' || !isNaN(Number(parteraId))) ? Number(parteraId) : 1;
        const values = [
            idParteraValido,
            datosNino.nombreNino,
            datosNino.edadMeses,
            datosNino.nombreMadre,
            datosNino.localidad,
            datosNino.municipio,
            datosNino.fechaAtencion,
            estadoNutricional,
            tipoLactancia,
            JSON.stringify(canalizaciones),
            cierreAdministrativo.mesInformado,
            cierreAdministrativo.nombreSupervisor,
            cierreAdministrativo.centroSaludAdscripcion,
            cierreAdministrativo.huellaFirmada,
            cierreAdministrativo.esCopiaCentroSalud
        ];
        const result = await db_1.pool.query(query, values);
        res.status(201).json({
            mensaje: 'Registro de calendario del niño guardado con éxito',
            registro: result.rows[0]
        });
    }
    catch (error) {
        console.error('Error al insertar el calendario del niño:', error);
        res.status(500).json({ error: 'Error interno al guardar el registro del niño' });
    }
});
//# sourceMappingURL=base%20de%20datos%20de%20tamiz.js.map