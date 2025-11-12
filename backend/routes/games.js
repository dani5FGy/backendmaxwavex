import express from 'express';
import { query, insert } from '../config/database.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Guardar resultado de juego
router.post('/result', authenticateToken, async (req, res) => {
    try {
        const { gameType, score, levelReached, timePlayed, metadata } = req.body;

        // Validaciones
        if (!gameType || score === undefined || !levelReached || !timePlayed) {
            return res.status(400).json({
                error: 'Datos incompletos',
                required: ['gameType', 'score', 'levelReached', 'timePlayed']
            });
        }

        if (score < 0 || levelReached < 1 || timePlayed < 0) {
            return res.status(400).json({
                error: 'Valores inválidos',
                message: 'Score, level y time deben ser valores positivos'
            });
        }

        const gameResult = {
            id_usuario: req.user.userType === 'guest' ? null : req.user.userId,
            id_sesion_invitado: req.user.userType === 'guest' ? req.user.guestId : null,
            tipo_juego: gameType,
            puntuacion: score,
            nivel_alcanzado: levelReached,
            tiempo_jugado: timePlayed,
            metadatos: metadata ? JSON.stringify(metadata) : null,
            fecha_juego: new Date()
        };

        const result = await insert('resultados_juegos', gameResult);

        res.status(201).json({
            message: 'Resultado guardado correctamente',
            resultId: result.insertId,
            score: score,
            levelReached: levelReached
        });

    } catch (error) {
        console.error('Error guardando resultado:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener tabla de líderes (leaderboard)
router.get('/leaderboard/:gameType', async (req, res) => {
    try {
        const { gameType } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);

        const leaderboard = await query(`
            SELECT 
                rj.puntuacion as score,
                rj.nivel_alcanzado as level_reached,
                rj.tiempo_jugado as time_played,
                rj.fecha_juego as played_at,
                COALESCE(u.nombre, si.nombre_usuario, 'Anónimo') as player_name,
                CASE 
                    WHEN u.id_usuario IS NOT NULL THEN 'registered'
                    WHEN si.id_sesion_invitado IS NOT NULL THEN 'guest'
                    ELSE 'anonymous'
                END as player_type
            FROM resultados_juegos rj
            LEFT JOIN usuarios u ON rj.id_usuario = u.id_usuario
            LEFT JOIN sesiones_invitados si ON rj.id_sesion_invitado = si.id_sesion_invitado
            WHERE rj.tipo_juego = ?
            ORDER BY rj.puntuacion DESC, rj.nivel_alcanzado DESC, rj.tiempo_jugado ASC
            LIMIT ?
        `, [gameType, limit]);

        // Agregar posición en el ranking
        const leaderboardWithRank = leaderboard.map((entry, index) => ({
            rank: index + 1,
            ...entry
        }));

        res.json({
            gameType,
            totalEntries: leaderboard.length,
            leaderboard: leaderboardWithRank
        });

    } catch (error) {
        console.error('Error obteniendo leaderboard:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener estadísticas personales del usuario
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        let userCondition, userParam;
        
        if (req.user.userType === 'guest') {
            userCondition = 'id_sesion_invitado = ?';
            userParam = req.user.guestId;
        } else {
            userCondition = 'id_usuario = ?';
            userParam = req.user.userId;
        }

        const stats = await query(`
            SELECT 
                COUNT(*) as total_games_played,
                COUNT(DISTINCT tipo_juego) as unique_games_played,
                MAX(puntuacion) as best_score,
                AVG(puntuacion) as average_score,
                MAX(nivel_alcanzado) as highest_level,
                AVG(nivel_alcanzado) as average_level,
                SUM(tiempo_jugado) as total_time_played,
                MIN(fecha_juego) as first_game,
                MAX(fecha_juego) as last_game
            FROM resultados_juegos 
            WHERE ${userCondition}
        `, [userParam]);

        // Estadísticas por tipo de juego
        const gameTypeStats = await query(`
            SELECT 
                tipo_juego as game_type,
                COUNT(*) as games_played,
                MAX(puntuacion) as best_score,
                AVG(puntuacion) as average_score,
                MAX(nivel_alcanzado) as highest_level,
                SUM(tiempo_jugado) as total_time
            FROM resultados_juegos 
            WHERE ${userCondition}
            GROUP BY tipo_juego
            ORDER BY best_score DESC
        `, [userParam]);

        // Progreso reciente (últimos 10 juegos)
        const recentGames = await query(`
            SELECT 
                tipo_juego as game_type,
                puntuacion as score,
                nivel_alcanzado as level_reached,
                tiempo_jugado as time_played,
                fecha_juego as played_at
            FROM resultados_juegos 
            WHERE ${userCondition}
            ORDER BY fecha_juego DESC
            LIMIT 10
        `, [userParam]);

        const result = {
            general: stats[0],
            byGameType: gameTypeStats,
            recentGames: recentGames
        };

        res.json(result);

    } catch (error) {
        console.error('Error obteniendo estadísticas del usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener mejores puntuaciones por juego
router.get('/personal-best/:gameType', authenticateToken, async (req, res) => {
    try {
        const { gameType } = req.params;
        let userCondition, userParam;
        
        if (req.user.userType === 'guest') {
            userCondition = 'id_sesion_invitado = ?';
            userParam = req.user.guestId;
        } else {
            userCondition = 'id_usuario = ?';
            userParam = req.user.userId;
        }

        const personalBest = await query(`
            SELECT 
                MAX(puntuacion) as best_score,
                MAX(nivel_alcanzado) as highest_level,
                MIN(tiempo_jugado) as fastest_time,
                COUNT(*) as times_played,
                AVG(puntuacion) as average_score,
                MAX(fecha_juego) as last_played
            FROM resultados_juegos 
            WHERE ${userCondition} AND tipo_juego = ?
        `, [userParam, gameType]);

        // Obtener el mejor resultado completo
        const bestGameDetails = await query(`
            SELECT 
                puntuacion as score, 
                nivel_alcanzado as level_reached, 
                tiempo_jugado as time_played, 
                fecha_juego as played_at, 
                metadatos as metadata
            FROM resultados_juegos 
            WHERE ${userCondition} AND tipo_juego = ?
            ORDER BY puntuacion DESC, nivel_alcanzado DESC, tiempo_jugado ASC
            LIMIT 1
        `, [userParam, gameType]);

        const result = {
            gameType,
            summary: personalBest[0],
            bestGame: bestGameDetails[0] || null
        };

        res.json(result);

    } catch (error) {
        console.error('Error obteniendo mejor puntuación personal:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener estadísticas globales del sistema
router.get('/system-stats', async (req, res) => {
    try {
        const globalStats = await query(`
            SELECT 
                COUNT(*) as total_games_played,
                COUNT(DISTINCT COALESCE(id_usuario, id_sesion_invitado)) as unique_players,
                COUNT(DISTINCT tipo_juego) as available_games,
                MAX(puntuacion) as highest_score_ever,
                AVG(puntuacion) as global_average_score,
                MAX(nivel_alcanzado) as highest_level_ever,
                SUM(tiempo_jugado) as total_playtime_seconds
            FROM resultados_juegos
        `);

        // Top juegos más jugados
        const popularGames = await query(`
            SELECT 
                tipo_juego as game_type,
                COUNT(*) as times_played,
                COUNT(DISTINCT COALESCE(id_usuario, id_sesion_invitado)) as unique_players,
                MAX(puntuacion) as highest_score,
                AVG(puntuacion) as average_score
            FROM resultados_juegos
            GROUP BY tipo_juego
            ORDER BY times_played DESC
            LIMIT 5
        `);

        // Actividad reciente
        const recentActivity = await query(`
            SELECT 
                DATE(fecha_juego) as game_date,
                COUNT(*) as games_played,
                COUNT(DISTINCT COALESCE(id_usuario, id_sesion_invitado)) as active_players
            FROM resultados_juegos
            WHERE fecha_juego >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(fecha_juego)
            ORDER BY game_date DESC
        `);

        const result = {
            global: globalStats[0],
            popularGames,
            weeklyActivity: recentActivity
        };

        res.json(result);

    } catch (error) {
        console.error('Error obteniendo estadísticas del sistema:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

export default router;