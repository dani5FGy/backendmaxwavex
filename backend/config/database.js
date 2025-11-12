import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
// Configuración de la base de datos
const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306'),
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  connectTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Configuración SSL para Railway
// Railway usa certificados autofirmados, así que necesitamos rejectUnauthorized: false
if (process.env.NODE_ENV === 'production' || process.env.MYSQLHOST) {
  dbConfig.ssl = {
    rejectUnauthorized: false  // Esto permite certificados autofirmados
  };
}

console.log('🔍 Configuración de DB:', {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  database: dbConfig.database,
  password: dbConfig.password ? '***SET***' : '***NOT SET***',
  ssl: !!dbConfig.ssl
});

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Función para probar la conexión
export const testConnection = async () => {
    try {
        console.log('🔄 Intentando conectar a MySQL...');
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('✅ Conexión a MySQL establecida correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error conectando a MySQL:', error.message);
        console.error('Detalles:', {
          code: error.code,
          errno: error.errno,
          fatal: error.fatal
        });
        throw error;
    }
};

export const query = async (sql, params = []) => {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('❌ Error ejecutando consulta:', error.message);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
};

export const transaction = async (callback) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const findById = async (table, id) => {
    const sql = `SELECT * FROM ${table} WHERE id = ? LIMIT 1`;
    const rows = await query(sql, [id]);
    return rows[0] || null;
};

export const findByField = async (table, field, value) => {
    const sql = `SELECT * FROM ${table} WHERE ${field} = ? LIMIT 1`;
    const rows = await query(sql, [value]);
    return rows[0] || null;
};

export const insert = async (table, data) => {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`;
    const result = await query(sql, values);
    
    return {
        insertId: result.insertId,
        affectedRows: result.affectedRows
    };
};

export const update = async (table, id, data, idField = null) => {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    if (!idField) {
        if (table === 'usuarios') idField = 'id_usuario';
        else if (table === 'modulos') idField = 'id_modulo';
        else if (table === 'progreso_usuarios') idField = 'id_progreso';
        else if (table === 'sesiones_invitados') idField = 'id_sesion_invitado';
        else idField = 'id';
    }

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${idField} = ?`;
    const result = await query(sql, [...values, id]);

    return {
        affectedRows: result.affectedRows,
        changedRows: result.changedRows
    };
};

export const deleteById = async (table, id) => {
    const sql = `DELETE FROM ${table} WHERE id = ?`;
    const result = await query(sql, [id]);
    
    return {
        affectedRows: result.affectedRows
    };
};

export default pool;