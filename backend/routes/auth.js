import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { query, insert, findByField, update } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Middleware para validar tokens JWT
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'maxwavex_secret_key', (err, decoded) => {
        if (err) {
            console.error('Error verificando token:', err);
            return res.status(403).json({ error: 'Token inválido' });
        }
        
        // Normalizar la estructura del usuario decodificado
        req.user = {
            userId: decoded.userId || decoded.guestId,
            guestId: decoded.guestId,
            sessionId: decoded.sessionId,
            email: decoded.email,
            username: decoded.username,
            userType: decoded.userType || 'student'
        };
        
        next();
    });
};

// Validaciones para registro
const registerValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Email inválido'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('La contraseña debe tener al menos 6 caracteres')
];

// Validaciones para login
const loginValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Email inválido'),
    body('password')
        .notEmpty()
        .withMessage('Contraseña requerida')
];

// Registro de usuarios
router.post('/register', registerValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Datos inválidos',
                details: errors.array()
            });
        }

        const { name, email, password } = req.body;

        const existingUser = await findByField('usuarios', 'correo_electronico', email.toLowerCase());
        if (existingUser) {
            return res.status(409).json({
                error: 'El email ya está registrado'
            });
        }

        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const userData = {
            nombre: name.trim(),
            correo_electronico: email.toLowerCase(),
            contrasena: passwordHash,
            tipo_usuario: 'estudiante',
            fecha_creacion: new Date(),
            esta_activo: true
        };

        const result = await insert('usuarios', userData);

        const token = jwt.sign(
            { 
                userId: result.insertId, 
                email: email.toLowerCase(),
                userType: 'student'
            },
            process.env.JWT_SECRET || 'maxwavex_secret_key',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'Usuario registrado exitosamente',
            user: {
                id: result.insertId,
                name: name.trim(),
                email: email.toLowerCase(),
                userType: 'student'
            },
            token
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Login de usuarios
router.post('/login', loginValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Datos inválidos',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        const user = await findByField('usuarios', 'correo_electronico', email.toLowerCase());
        if (!user) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        if (!user.esta_activo) {
            return res.status(401).json({
                error: 'Cuenta desactivada'
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.contrasena);
        if (!passwordMatch) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        // Actualizar último login
        await update('usuarios', user.id_usuario, { ultimo_inicio_sesion: new Date() });

        const token = jwt.sign(
            { 
                userId: user.id_usuario, 
                email: user.correo_electronico,
                userType: user.tipo_usuario
            },
            process.env.JWT_SECRET || 'maxwavex_secret_key',
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login exitoso',
            user: {
                id: user.id_usuario,
                name: user.nombre,
                email: user.correo_electronico,
                userType: user.tipo_usuario
            },
            token
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Crear sesión de invitado
router.post('/guest', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username || username.trim().length < 2) {
            return res.status(400).json({
                error: 'Nombre de usuario requerido (mínimo 2 caracteres)'
            });
        }

        const sessionId = uuidv4();
        const expiresAt = new Date(Date.now() + 3600000); // 1 hora

        const guestData = {
            identificador_sesion: sessionId,
            nombre_usuario: username.trim(),
            fecha_creacion: new Date(),
            fecha_expiracion: expiresAt,
            esta_activo: true
        };

        const result = await insert('sesiones_invitados', guestData);

        const token = jwt.sign(
            { 
                guestId: result.insertId,
                sessionId: sessionId,
                username: username.trim(),
                userType: 'guest'
            },
            process.env.JWT_SECRET || 'maxwavex_secret_key',
            { expiresIn: '1h' }
        );

        res.json({
            message: 'Sesión de invitado creada',
            guest: {
                id: result.insertId,
                sessionId: sessionId,
                username: username.trim(),
                userType: 'guest',
                expiresAt: expiresAt
            },
            token
        });

    } catch (error) {
        console.error('Error creando sesión de invitado:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Verificar token
router.get('/verify', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            const guest = await query(
                'SELECT * FROM sesiones_invitados WHERE id_sesion_invitado = ? AND esta_activo = true AND fecha_expiracion > NOW()',
                [req.user.guestId]
            );

            if (!guest || guest.length === 0) {
                return res.status(401).json({
                    error: 'Sesión de invitado expirada'
                });
            }

            return res.json({
                valid: true,
                user: {
                    id: guest[0].id_sesion_invitado,
                    sessionId: guest[0].identificador_sesion,
                    username: guest[0].nombre_usuario,
                    userType: 'guest'
                }
            });
        } else {
            const user = await findByField('usuarios', 'id_usuario', req.user.userId);
            
            if (!user || !user.esta_activo) {
                return res.status(401).json({
                    error: 'Usuario no encontrado o inactivo'
                });
            }

            return res.json({
                valid: true,
                user: {
                    id: user.id_usuario,
                    name: user.nombre,
                    email: user.correo_electronico,
                    userType: user.tipo_usuario
                }
            });
        }

    } catch (error) {
        console.error('Error verificando token:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest' && req.user.guestId) {
            await update('sesiones_invitados', req.user.guestId, { esta_activo: false });
        }

        res.json({
            message: 'Logout exitoso'
        });

    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Obtener perfil del usuario
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        if (req.user.userType === 'guest') {
            const guest = await query(
                'SELECT * FROM sesiones_invitados WHERE id_sesion_invitado = ? AND esta_activo = true',
                [req.user.guestId]
            );

            if (!guest || guest.length === 0) {
                return res.status(404).json({
                    error: 'Sesión no encontrada'
                });
            }

            return res.json({
                id: guest[0].id_sesion_invitado,
                username: guest[0].nombre_usuario,
                userType: 'guest',
                sessionId: guest[0].identificador_sesion,
                expiresAt: guest[0].fecha_expiracion
            });
        } else {
            const user = await findByField('usuarios', 'id_usuario', req.user.userId);
            
            if (!user) {
                return res.status(404).json({
                    error: 'Usuario no encontrado'
                });
            }

            return res.json({
                id: user.id_usuario,
                name: user.nombre,
                email: user.correo_electronico,
                userType: user.tipo_usuario,
                createdAt: user.fecha_creacion,
                lastLogin: user.ultimo_inicio_sesion
            });
        }

    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

export default router;