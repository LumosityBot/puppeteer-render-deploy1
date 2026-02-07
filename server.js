import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import MultiGameBot from './MultiGameBot.js';
import { GAMES_CONFIG } from './gamesConfig.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Servir les fichiers statiques (interface web)
app.use(express.static('public'));

// Variables globales
let bot = null;
let botProcess = null;

// =============================================================================
// ROUTES API
// =============================================================================

/**
 * GET /api - Documentation de l'API
 */
app.get('/api', (req, res) => {
    res.json({
        message: 'Multi-Game Bot API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            '/': 'GET - Documentation de l\'API',
            '/games': 'GET - Liste des jeux disponibles',
            '/start': 'POST - Démarrer le bot',
            '/stop': 'POST - Arrêter le bot',
            '/pause': 'POST - Mettre en pause',
            '/resume': 'POST - Reprendre',
            '/status': 'GET - Statut du bot',
            '/stats': 'GET - Statistiques détaillées',
            '/logs': 'GET - Logs récents'
        },
        documentation: {
            start: {
                method: 'POST',
                body: {
                    gameKey: 'string (ex: "bowling")',
                    phone: 'string (ex: "66299709")',
                    password: 'string (ex: "90799266")',
                    numGames: 'number (1-100)'
                },
                example: {
                    gameKey: 'bowling',
                    phone: '66299709',
                    password: '90799266',
                    numGames: 5
                }
            }
        }
    });
});

/**
 * GET /games - Liste des jeux disponibles
 */
app.get('/games', (req, res) => {
    const games = Object.keys(GAMES_CONFIG).map(key => ({
        key: key,
        name: GAMES_CONFIG[key].name,
        loginUrl: GAMES_CONFIG[key].loginUrl,
        sequences: GAMES_CONFIG[key].sequences.length
    }));

    res.json({
        success: true,
        games: games,
        count: games.length
    });
});

/**
 * POST /start - Démarrer le bot
 * Body: { gameKey, phone, password, numGames }
 */
app.post('/start', async (req, res) => {
    try {
        // Vérifier si un bot est déjà en cours
        if (bot && bot.stats.isRunning) {
            return res.status(400).json({
                success: false,
                error: 'Un bot est déjà en cours d\'exécution',
                currentGame: bot.stats.currentGame,
                totalGames: bot.stats.totalGames
            });
        }

        // Valider les paramètres
        const { gameKey, phone, password, numGames } = req.body;

        if (!gameKey) {
            return res.status(400).json({
                success: false,
                error: 'gameKey est requis',
                availableGames: Object.keys(GAMES_CONFIG)
            });
        }

        if (!GAMES_CONFIG[gameKey]) {
            return res.status(400).json({
                success: false,
                error: `Jeu '${gameKey}' non trouvé`,
                availableGames: Object.keys(GAMES_CONFIG)
            });
        }

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                error: 'phone et password sont requis'
            });
        }

        if (!numGames || numGames < 1 || numGames > 100) {
            return res.status(400).json({
                success: false,
                error: 'numGames doit être entre 1 et 100'
            });
        }

        // Créer le bot
        bot = new MultiGameBot(gameKey, phone, password);

        // Lancer le bot en arrière-plan
        botProcess = bot.runMultipleGames(numGames).catch(error => {
            console.error('Erreur dans le processus du bot:', error);
        });

        res.json({
            success: true,
            message: 'Bot démarré avec succès',
            config: {
                game: GAMES_CONFIG[gameKey].name,
                phone: phone,
                numGames: numGames
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /stop - Arrêter le bot
 */
app.post('/stop', (req, res) => {
    if (!bot) {
        return res.status(400).json({
            success: false,
            error: 'Aucun bot en cours'
        });
    }

    if (!bot.stats.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'Le bot n\'est pas en cours d\'exécution'
        });
    }

    bot.stop();

    res.json({
        success: true,
        message: 'Arrêt du bot demandé',
        stats: bot.getStats()
    });
});

/**
 * POST /pause - Mettre le bot en pause
 */
app.post('/pause', (req, res) => {
    if (!bot || !bot.stats.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'Aucun bot en cours'
        });
    }

    if (bot.stats.isPaused) {
        return res.status(400).json({
            success: false,
            error: 'Le bot est déjà en pause'
        });
    }

    bot.pause();

    res.json({
        success: true,
        message: 'Bot mis en pause'
    });
});

/**
 * POST /resume - Reprendre le bot
 */
app.post('/resume', (req, res) => {
    if (!bot || !bot.stats.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'Aucun bot en cours'
        });
    }

    if (!bot.stats.isPaused) {
        return res.status(400).json({
            success: false,
            error: 'Le bot n\'est pas en pause'
        });
    }

    bot.resume();

    res.json({
        success: true,
        message: 'Bot repris'
    });
});

/**
 * GET /status - Statut simple du bot
 */
app.get('/status', (req, res) => {
    if (!bot) {
        return res.json({
            success: true,
            hasBot: false,
            isRunning: false,
            message: 'Aucun bot actif'
        });
    }

    res.json({
        success: true,
        hasBot: true,
        isRunning: bot.stats.isRunning,
        isPaused: bot.stats.isPaused,
        currentGame: bot.stats.currentGame,
        totalGames: bot.stats.totalGames,
        progress: bot.stats.totalGames > 0 
            ? Math.round((bot.stats.currentGame / bot.stats.totalGames) * 100) 
            : 0
    });
});

/**
 * GET /stats - Statistiques détaillées
 */
app.get('/stats', (req, res) => {
    if (!bot) {
        return res.json({
            success: true,
            hasBot: false,
            stats: null
        });
    }

    const stats = bot.getStats();
    
    res.json({
        success: true,
        hasBot: true,
        stats: {
            ...stats,
            uptimeFormatted: formatUptime(stats.uptime),
            successRate: stats.gamesPlayed > 0 
                ? Math.round((stats.gamesSuccessful / stats.gamesPlayed) * 100) 
                : 0
        }
    });
});

/**
 * GET /logs - Récupérer les logs récents
 * Query params: ?count=50 (nombre de logs, par défaut 50)
 */
app.get('/logs', (req, res) => {
    if (!bot) {
        return res.json({
            success: true,
            hasBot: false,
            logs: []
        });
    }

    const count = parseInt(req.query.count) || 50;
    const logs = bot.getLogs(count);

    res.json({
        success: true,
        hasBot: true,
        count: logs.length,
        logs: logs
    });
});

// =============================================================================
// FONCTIONS UTILITAIRES
// =============================================================================

/**
 * Formate le temps en heures/minutes/secondes
 */
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// =============================================================================
// GESTION DES ERREURS ET ARRÊT PROPRE
// =============================================================================

// Gestion des erreurs non capturées
app.use((err, req, res, next) => {
    console.error('Erreur non gérée:', err);
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        message: err.message
    });
});

// Route 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route non trouvée',
        path: req.path
    });
});

// Arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    
    if (bot && bot.stats.isRunning) {
        console.log('⏹️  Arrêt du bot...');
        bot.stop();
        // Attendre un peu pour que le bot s'arrête proprement
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log('👋 Serveur arrêté');
    process.exit(0);
});

// =============================================================================
// DÉMARRAGE DU SERVEUR
// =============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 MULTI-GAME BOT API');
    console.log('='.repeat(60));
    console.log(`📡 Serveur démarré sur le port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('\n📋 Endpoints disponibles:');
    console.log(`   GET  / - Documentation`);
    console.log(`   GET  /games - Liste des jeux`);
    console.log(`   POST /start - Démarrer le bot`);
    console.log(`   POST /stop - Arrêter le bot`);
    console.log(`   POST /pause - Pause`);
    console.log(`   POST /resume - Reprendre`);
    console.log(`   GET  /status - Statut`);
    console.log(`   GET  /stats - Statistiques`);
    console.log(`   GET  /logs - Logs`);
    console.log('='.repeat(60));
    console.log(`\n🎮 Jeux disponibles: ${Object.keys(GAMES_CONFIG).join(', ')}`);
    console.log('\n✅ Prêt à recevoir des requêtes!\n');
});

export default app;
