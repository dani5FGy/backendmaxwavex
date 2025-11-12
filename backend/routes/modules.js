import express from 'express';
import { query, findById } from '../config/database.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Obtener todos los módulos (público)
router.get('/', async (req, res) => {
    try {
        const modules = await query(`
            SELECT 
                id_modulo as id, 
                titulo as title, 
                descripcion as description, 
                tipo_contenido as content_type, 
                nivel_dificultad as difficulty_level, 
                indice_orden as order_index, 
                esta_activo as is_active
            FROM modulos 
            WHERE esta_activo = true 
            ORDER BY indice_orden ASC
        `);

        res.json(modules);
    } catch (error) {
        console.error('Error obteniendo módulos:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener módulo por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const moduleResult = await query(
            'SELECT * FROM modulos WHERE id_modulo = ?',
            [id]
        );
        
        if (!moduleResult || moduleResult.length === 0) {
            return res.status(404).json({
                error: 'Módulo no encontrado'
            });
        }

        const module = moduleResult[0];

        if (!module.esta_activo) {
            return res.status(404).json({
                error: 'Módulo no disponible'
            });
        }

        // Mapear nombres de columnas al formato esperado por el frontend
        const moduleResponse = {
            id: module.id_modulo,
            title: module.titulo,
            description: module.descripcion,
            content: module.contenido,
            content_type: module.tipo_contenido,
            difficulty_level: module.nivel_dificultad,
            order_index: module.indice_orden,
            is_active: module.esta_activo,
            created_at: module.fecha_creacion
        };

        res.json(moduleResponse);
    } catch (error) {
        console.error('Error obteniendo módulo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener módulos por tipo de contenido
router.get('/type/:contentType', async (req, res) => {
    try {
        const { contentType } = req.params;
        
        // Mapear tipos en inglés a español
        const typeMap = {
            'theory': 'teoria',
            'equations': 'ecuaciones',
            'applications': 'aplicaciones',
            'simulation': 'simulacion',
            'game': 'juego'
        };

        const tipoContenido = typeMap[contentType] || contentType;
        
        const validTypes = ['teoria', 'ecuaciones', 'aplicaciones', 'simulacion', 'juego'];
        if (!validTypes.includes(tipoContenido)) {
            return res.status(400).json({
                error: 'Tipo de contenido inválido'
            });
        }

        const modules = await query(`
            SELECT 
                id_modulo as id, 
                titulo as title, 
                descripcion as description, 
                tipo_contenido as content_type, 
                nivel_dificultad as difficulty_level, 
                indice_orden as order_index
            FROM modulos 
            WHERE tipo_contenido = ? AND esta_activo = true 
            ORDER BY indice_orden ASC
        `, [tipoContenido]);

        res.json(modules);
    } catch (error) {
        console.error('Error obteniendo módulos por tipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener estadísticas de módulos (requiere autenticación)
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as total_modules,
                COUNT(CASE WHEN nivel_dificultad = 'principiante' THEN 1 END) as basic_modules,
                COUNT(CASE WHEN nivel_dificultad = 'intermedio' THEN 1 END) as intermediate_modules,
                COUNT(CASE WHEN nivel_dificultad = 'avanzado' THEN 1 END) as advanced_modules,
                COUNT(CASE WHEN tipo_contenido = 'teoria' THEN 1 END) as theory_modules,
                COUNT(CASE WHEN tipo_contenido = 'ecuaciones' THEN 1 END) as equations_modules,
                COUNT(CASE WHEN tipo_contenido = 'aplicaciones' THEN 1 END) as applications_modules,
                COUNT(CASE WHEN tipo_contenido = 'simulacion' THEN 1 END) as simulation_modules,
                COUNT(CASE WHEN tipo_contenido = 'juego' THEN 1 END) as game_modules
            FROM modulos 
            WHERE esta_activo = true
        `);

        res.json(stats[0]);
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

export default router;