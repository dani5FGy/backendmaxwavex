import express from 'express';
import { query, insert, update, findById } from '../config/database.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Middleware: solo usuarios registrados pueden tener progreso
const requireRegisteredUser = (req, res, next) => {
    if (req.user.userType === 'guest') {
        return res.status(200).json([]);
    }
    next();
};

// Obtener progreso del usuario
router.get('/', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            return res.json([]);
        }

        const userId = req.user.userId;

        const progress = await query(`
            SELECT 
                pu.id_progreso,
                pu.id_modulo as module_id,
                pu.porcentaje_completado as completion_percentage,
                pu.tiempo_empleado as time_spent,
                pu.ultimo_acceso as last_accessed,
                pu.esta_completado as is_completed,
                pu.puntuacion as score,
                m.titulo as module_title,
                m.tipo_contenido as content_type,
                m.nivel_dificultad as difficulty_level
            FROM progreso_usuarios pu
            JOIN modulos m ON pu.id_modulo = m.id_modulo
            WHERE pu.id_usuario = ?
            ORDER BY m.indice_orden ASC
        `, [userId]);

        res.json(progress);
    } catch (error) {
        console.error('Error obteniendo progreso:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Obtener progreso de un módulo específico
router.get('/:moduleId', authenticateToken, requireRegisteredUser, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { moduleId } = req.params;

        const module = await findById('modulos', moduleId);
        if (!module) {
            return res.status(404).json({
                error: 'Módulo no encontrado'
            });
        }

        const progress = await query(`
            SELECT 
                pu.*,
                m.titulo as module_title,
                m.tipo_contenido as content_type,
                m.nivel_dificultad as difficulty_level
            FROM progreso_usuarios pu
            JOIN modulos m ON pu.id_modulo = m.id_modulo
            WHERE pu.id_usuario = ? AND pu.id_modulo = ?
        `, [userId, moduleId]);

        if (progress.length === 0) {
            const newProgress = {
                id_usuario: userId,
                id_modulo: moduleId,
                porcentaje_completado: 0,
                tiempo_empleado: 0,
                esta_completado: false,
                puntuacion: 0
            };

            const result = await insert('progreso_usuarios', newProgress);
            
            const createdProgress = await query(`
                SELECT 
                    pu.*,
                    m.titulo as module_title,
                    m.tipo_contenido as content_type,
                    m.nivel_dificultad as difficulty_level
                FROM progreso_usuarios pu
                JOIN modulos m ON pu.id_modulo = m.id_modulo
                WHERE pu.id_progreso = ?
            `, [result.insertId]);

            return res.json(createdProgress[0]);
        }

        res.json(progress[0]);
    } catch (error) {
        console.error('Error obteniendo progreso del módulo:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Actualizar progreso de un módulo
router.put('/:moduleId', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            return res.status(200).json({
                message: 'El progreso no se guarda para usuarios invitados',
                tip: 'Crea una cuenta para guardar tu progreso'
            });
        }

        const userId = req.user.userId;
        const { moduleId } = req.params;
        const { completion_percentage, time_spent, score } = req.body;

        // Validaciones
        if (completion_percentage !== undefined && (completion_percentage < 0 || completion_percentage > 100)) {
            return res.status(400).json({
                error: 'El porcentaje de completado debe estar entre 0 y 100'
            });
        }

        if (time_spent !== undefined && time_spent < 0) {
            return res.status(400).json({
                error: 'El tiempo gastado no puede ser negativo'
            });
        }

        if (score !== undefined && score < 0) {
            return res.status(400).json({
                error: 'La puntuación no puede ser negativa'
            });
        }

        const module = await findById('modulos', moduleId);
        if (!module) {
            return res.status(404).json({
                error: 'Módulo no encontrado'
            });
        }

        const existingProgress = await query(`
            SELECT id_progreso FROM progreso_usuarios 
            WHERE id_usuario = ? AND id_modulo = ?
        `, [userId, moduleId]);

        let progressData = {
            porcentaje_completado: completion_percentage || 0,
            tiempo_empleado: time_spent || 0,
            puntuacion: score || 0,
            esta_completado: completion_percentage >= 100,
            ultimo_acceso: new Date()
        };

        let result;
        if (existingProgress.length === 0) {
            progressData.id_usuario = userId;
            progressData.id_modulo = moduleId;
            result = await insert('progreso_usuarios', progressData);
        } else {
            result = await update('progreso_usuarios', existingProgress[0].id_progreso, progressData);
        }

        const updatedProgress = await query(`
            SELECT 
                pu.*,
                m.titulo as module_title,
                m.tipo_contenido as content_type,
                m.nivel_dificultad as difficulty_level
            FROM progreso_usuarios pu
            JOIN modulos m ON pu.id_modulo = m.id_modulo
            WHERE pu.id_usuario = ? AND pu.id_modulo = ?
        `, [userId, moduleId]);

        res.json({
            message: 'Progreso actualizado correctamente',
            progress: updatedProgress[0]
        });

    } catch (error) {
        console.error('Error actualizando progreso:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Marcar módulo como completado
router.post('/:moduleId/complete', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            return res.status(200).json({
                message: 'El progreso no se guarda para usuarios invitados',
                tip: 'Crea una cuenta para guardar tu progreso'
            });
        }

        const userId = req.user.userId;
        const { moduleId } = req.params;
        const { score } = req.body;

        const module = await findById('modulos', moduleId);
        if (!module) {
            return res.status(404).json({
                error: 'Módulo no encontrado'
            });
        }

        const existingProgress = await query(`
            SELECT id_progreso FROM progreso_usuarios 
            WHERE id_usuario = ? AND id_modulo = ?
        `, [userId, moduleId]);

        let progressData = {
            porcentaje_completado: 100,
            esta_completado: true,
            puntuacion: score || 0,
            ultimo_acceso: new Date()
        };

        if (existingProgress.length === 0) {
            progressData.id_usuario = userId;
            progressData.id_modulo = moduleId;
            progressData.tiempo_empleado = 0;
            await insert('progreso_usuarios', progressData);
        } else {
            await update('progreso_usuarios', existingProgress[0].id_progreso, progressData);
        }

        const completedProgress = await query(`
            SELECT 
                pu.*,
                m.titulo as module_title,
                m.tipo_contenido as content_type,
                m.nivel_dificultad as difficulty_level
            FROM progreso_usuarios pu
            JOIN modulos m ON pu.id_modulo = m.id_modulo
            WHERE pu.id_usuario = ? AND pu.id_modulo = ?
        `, [userId, moduleId]);

        res.json({
            message: 'Módulo completado correctamente',
            progress: completedProgress[0]
        });

    } catch (error) {
        console.error('Error completando módulo:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Obtener estadísticas generales del usuario
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            return res.json({
                total_modules_started: 0,
                completed_modules: 0,
                average_completion: 0,
                total_time_spent: 0,
                total_score: 0,
                best_score: 0,
                first_access: null,
                last_access: null,
                total_available_modules: 0,
                completion_rate: 0
            });
        }

        const userId = req.user.userId;

        const stats = await query(`
            SELECT 
                COUNT(*) as total_modules_started,
                COUNT(CASE WHEN esta_completado = true THEN 1 END) as completed_modules,
                ROUND(AVG(porcentaje_completado), 2) as average_completion,
                SUM(tiempo_empleado) as total_time_spent,
                SUM(puntuacion) as total_score,
                MAX(puntuacion) as best_score,
                MIN(ultimo_acceso) as first_access,
                MAX(ultimo_acceso) as last_access
            FROM progreso_usuarios 
            WHERE id_usuario = ?
        `, [userId]);

        const totalModules = await query(`
            SELECT COUNT(*) as total_available 
            FROM modulos 
            WHERE esta_activo = true
        `);

        const result = {
            ...stats[0],
            total_available_modules: totalModules[0].total_available,
            completion_rate: totalModules[0].total_available > 0 
                ? Math.round((stats[0].completed_modules / totalModules[0].total_available) * 100) 
                : 0
        };

        res.json(result);
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

export default router;