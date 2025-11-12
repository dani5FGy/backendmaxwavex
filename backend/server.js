import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Importar rutas
import authRoutes from './routes/auth.js';
import moduleRoutes from './routes/modules.js';
import progressRoutes from './routes/progress.js';
import gameRoutes from './routes/games.js';

// Importar configuración de base de datos
import { testConnection } from './config/database.js';

// Configuración de variables de entorno (solo en desarrollo)
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware de seguridad
app.use(helmet());

// Configuración de CORS
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://maxwavex-web.vercel.app',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por ventana de tiempo por IP
    message: {
        error: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.'
    }
});
app.use('/api/', limiter);

// Middleware para parsing JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/games', gameRoutes);

// Ruta de salud del servidor
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Ruta raíz para verificar que el servidor está corriendo
app.get('/', (req, res) => {
    res.json({
        message: 'MaxWaveX API is running',
        status: 'OK',
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            modules: '/api/modules',
            progress: '/api/progress',
            games: '/api/games'
        }
    });
});

// Servir archivos estáticos SOLO si existe la carpeta dist
// (esto es para desarrollo local, no para Railway)
const distPath = join(__dirname, '../frontend/dist');
if (existsSync(distPath)) {
    console.log('📁 Sirviendo archivos estáticos desde:', distPath);
    app.use(express.static(distPath));
    
    app.get('*', (req, res) => {
        // Solo servir index.html para rutas que no sean de API
        if (!req.path.startsWith('/api')) {
            res.sendFile(join(distPath, 'index.html'));
        }
    });
} else {
    console.log('ℹ️ No se encontró carpeta dist - API mode only');
}

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    
    // Error de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Error de validación',
            details: err.message
        });
    }
    
    // Error de base de datos
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            error: 'Registro duplicado',
            message: 'Este email ya está registrado'
        });
    }
    
    // Error genérico del servidor
    res.status(500).json({
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
    });
});

// Manejo de rutas no encontradas (solo para rutas de API)
app.use('/api/*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        message: `La ruta ${req.originalUrl} no existe`
    });
});

// Función para iniciar el servidor
async function startServer() {
    try {
        // Probar conexión a la base de datos
        await testConnection();
        console.log('✅ Conexión a la base de datos establecida');
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor ejecutándose en http://0.0.0.0:${PORT}`);
            console.log(`📖 API documentada en http://0.0.0.0:${PORT}/api/health`);
            console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('❌ Error al iniciar el servidor:', error);
        process.exit(1);
    }
}

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM recibido, cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT recibido, cerrando servidor...');
    process.exit(0);
});

// Iniciar servidor
startServer();