import puppeteer from 'puppeteer';
import { GAMES_CONFIG, GENERAL_CONFIG } from './gamesConfig.js';

class MultiGameBot {
    constructor(gameKey, phone, password) {
        if (!GAMES_CONFIG[gameKey]) {
            throw new Error(`Jeu '${gameKey}' non trouvé dans la configuration!`);
        }

        this.gameConfig = GAMES_CONFIG[gameKey];
        this.gameKey = gameKey;
        this.phone = phone;
        this.password = password;

        // URLs
        this.loginUrl = this.gameConfig.loginUrl;
        this.homeUrl = this.gameConfig.homeUrl;
        this.gameUrl = this.gameConfig.gameUrl;
        this.gameUrlCmp = this.gameConfig.gameUrlCmp;

        // Paramètres du jeu
        this.roomCode = this.gameConfig.roomCode;
        this.delayBetweenScores = this.gameConfig.delayBetweenScores;
        this.sequences = this.gameConfig.sequences;

        this.browser = null;
        this.page = null;

        // Stats et logs
        this.stats = {
            gamesPlayed: 0,
            gamesSuccessful: 0,
            gamesFailed: 0,
            currentGame: 0,
            totalGames: 0,
            startTime: null,
            lastGameScore: null,
            isRunning: false,
            isPaused: false
        };

        this.logs = [];
        this.shouldStop = false;

        console.log(`\n🎮 Jeu sélectionné: ${this.gameConfig.name}`);
        console.log(`📍 Login URL: ${this.loginUrl}`);
        console.log(`📍 Game URL: ${this.gameUrl}`);
        console.log(`🎯 Nombre de séquences disponibles: ${this.sequences.length}`);
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, message, type };
        this.logs.push(logEntry);
        
        // Garder seulement les 100 derniers logs
        if (this.logs.length > 100) {
            this.logs.shift();
        }

        // Console output avec emoji selon le type
        const emoji = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️',
            game: '🎮'
        };
        console.log(`${emoji[type] || 'ℹ️'} [${timestamp}] ${message}`);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async setupDriver(headless = true) {
        this.addLog('Configuration du navigateur...', 'info');
        
        const options = {
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-setuid-sandbox'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                           process.env.CHROME_PATH || 
                           '/usr/bin/google-chrome-stable',
            headless: headless ? 'new' : false,
            timeout: 60000
        };

        this.browser = await puppeteer.launch(options);
        this.page = await this.browser.newPage();
        
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setViewport({ width: 1280, height: 720 });

        // Masquer le fait qu'on utilise automation
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });

        this.addLog('Navigateur initialisé avec succès', 'success');
    }

    async login() {
        const maxAttempts = GENERAL_CONFIG.maxLoginAttempts;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.addLog(`Tentative de connexion ${attempt}/${maxAttempts}`, 'info');

            try {
                await this.page.goto(this.loginUrl, { waitUntil: 'networkidle2' });
                this.addLog(`Navigation vers: ${this.loginUrl}`, 'info');

                // Attendre le formulaire
                await this.page.waitForSelector('#msisdn', { timeout: 10000 });

                // Remplir le formulaire
                await this.page.type('#msisdn', this.phone);
                await this.sleep(500);
                await this.page.type('#password', this.password);
                await this.sleep(500);

                this.addLog(`Formulaire rempli - Phone: ${this.phone}`, 'info');

                // Cliquer sur login
                await this.page.click('#login');
                this.addLog('Bouton LOGIN cliqué', 'info');

                // Attendre la redirection
                await this.sleep(GENERAL_CONFIG.pageLoadWait);

                const currentUrl = this.page.url();
                this.addLog(`URL actuelle: ${currentUrl}`, 'info');

                if (currentUrl.includes(this.homeUrl)) {
                    this.addLog('Connexion réussie!', 'success');
                    return true;
                } else {
                    this.addLog(`Échec - pas redirigé vers ${this.homeUrl}`, 'error');
                }
            } catch (error) {
                this.addLog(`Erreur lors de la tentative ${attempt}: ${error.message}`, 'error');
            }
        }

        this.addLog(`Échec de connexion après ${maxAttempts} tentatives`, 'error');
        return false;
    }

    async navigateToGame() {
        try {
            this.addLog(`Navigation vers le jeu: ${this.gameUrl}`, 'game');
            await this.page.goto(this.gameUrl, { waitUntil: 'networkidle2' });
            await this.sleep(GENERAL_CONFIG.pageLoadWait);

            const currentUrl = this.page.url();
            this.addLog(`URL après navigation: ${currentUrl}`, 'info');

            if (currentUrl.includes(this.gameUrlCmp)) {
                this.addLog('Page de jeu chargée (après redirection)', 'success');
                return true;
            } else if (currentUrl.includes(this.gameUrl)) {
                this.addLog('Sur URL initiale, attente de redirection...', 'info');
                await this.sleep(3000);
                
                const newUrl = this.page.url();
                if (newUrl.includes(this.gameUrlCmp)) {
                    this.addLog('Page de jeu chargée (après redirection)', 'success');
                    return true;
                }
            } else if (currentUrl.includes(this.loginUrl)) {
                this.addLog('Redirigé vers login - reconnexion nécessaire', 'warning');
                if (await this.login()) {
                    return await this.navigateToGame();
                }
                return false;
            } else if (currentUrl.includes(this.homeUrl)) {
                this.addLog('Redirigé vers Home - ERREUR', 'error');
                return false;
            }

            this.addLog(`URL inattendue: ${currentUrl}`, 'error');
            return false;
        } catch (error) {
            this.addLog(`Erreur navigation: ${error.message}`, 'error');
            return false;
        }
    }

    generateGameScript(sequence) {
        const sequenceStr = JSON.stringify(sequence);
        const delayMs = this.delayBetweenScores * 1000;

        return `
(async function() {
    const sequence = ${sequenceStr};
    const DELAY_BETWEEN_SCORES = ${delayMs};
    const ROOM_CODE = "${this.roomCode}";
    
    console.log('🎳 Démarrage du jeu automatique');
    console.log('📊 Séquence:', sequence);
    console.log('🎯 Score final:', sequence[sequence.length - 1]);
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    if (typeof Cjfs === 'undefined') {
        console.error('❌ Cjfs non disponible!');
        return;
    }
    if (typeof signalRService === 'undefined') {
        console.error('❌ signalRService non disponible!');
        return;
    }
    
    async function sendScoreRealTime(score) {
        try {
            const encoder = new Cjfs();
            const encodedScore = await encoder.endcode(score);
            
            signalRService.sendScore(
                String(score),
                encodedScore,
                ROOM_CODE
            );
            
            console.log(\`✅ SignalR envoyé - Score: \${score}\`);
        } catch (e) {
            console.error('❌ Erreur SignalR:', e);
        }
    }
    
    async function sendFinalScore(score) {
        try {
            console.log(\`📤 Envoi score FINAL: \${score}\`);
            
            const encoder = new Cjfs();
            const encodedScore = await encoder.endcode(score);
            
            const token = $('input[name=__RequestVerificationToken]').val();
            
            if (!token) {
                console.error('❌ Token CSRF non trouvé!');
                return;
            }
            
            const data = {
                playGameCoins: score,
                code: encodedScore
            };
            
            const response = await $.ajax({
                type: 'POST',
                url: '/Game/AddCoins',
                headers: {
                    'RequestVerificationToken': token,
                    'Accept': 'application/json'
                },
                data: data
            });
            
            console.log('✅ Réponse serveur:', response);
            console.log('🎉 PARTIE TERMINÉE AVEC SUCCÈS !');
            
            setTimeout(() => {
                console.log('🔄 Redirection vers Home...');
                window.location.href = '/Home/Index';
            }, 7000);
            
        } catch (e) {
            console.error('❌ Erreur envoi final:', e);
        }
    }
    
    try {
        console.log('🚀 Début de la séquence...');
        
        for (let i = 0; i < sequence.length - 1; i++) {
            const score = sequence[i];
            console.log(\`🎯 Envoi score \${i + 1}/\${sequence.length - 1}: \${score}\`);
            
            await sendScoreRealTime(score);
            
            if (i < sequence.length - 2) {
                await sleep(DELAY_BETWEEN_SCORES);
            }
        }
        
        console.log('🏁 Tous les scores temps réel envoyés !');
        await sleep(100);
        
        const finalScore = sequence[sequence.length - 1];
        await sendFinalScore(finalScore);
        
    } catch (error) {
        console.error('❌ Erreur dans la boucle principale:', error);
    }
})();
`;
    }

    async playGame() {
        try {
            // Choisir une séquence aléatoire
            const sequence = this.sequences[Math.floor(Math.random() * this.sequences.length)];
            const finalScore = sequence[sequence.length - 1];

            this.addLog('Partie démarrée!', 'game');
            this.addLog(`Séquence choisie (score final: ${finalScore})`, 'game');
            this.addLog(`Nombre de scores: ${sequence.length}`, 'info');

            // Enregistrer le score pour les stats
            this.stats.lastGameScore = finalScore;

            // Attendre avant de commencer
            await this.sleep(3000);

            // Générer et exécuter le script
            const gameScript = this.generateGameScript(sequence);
            this.addLog('Exécution du script de jeu...', 'game');
            await this.page.evaluate(gameScript);

            // Attendre la fin de la partie
            const waitTime = (sequence.length * this.delayBetweenScores + 30) * 1000;
            this.addLog(`Attente de fin de partie (~${waitTime/1000}s)...`, 'info');

            await this.sleep(waitTime);

            this.addLog('Partie terminée!', 'success');

            // Vérifier retour sur Home
            const currentUrl = this.page.url();
            if (currentUrl.includes(this.homeUrl)) {
                this.addLog('Retour sur Home confirmé', 'success');
            }

            return true;
        } catch (error) {
            this.addLog(`Erreur pendant le jeu: ${error.message}`, 'error');
            return false;
        }
    }

    async runMultipleGames(numGames) {
        try {
            this.stats.totalGames = numGames;
            this.stats.startTime = new Date();
            this.stats.isRunning = true;
            this.shouldStop = false;

            this.addLog(`=== DÉMARRAGE DU BOT - ${this.gameConfig.name} ===`, 'game');
            this.addLog(`Parties à jouer: ${numGames}`, 'info');

            // Setup
            await this.setupDriver(true);

            // Connexion
            if (!await this.login()) {
                this.addLog('Arrêt du bot - échec de connexion', 'error');
                this.stats.isRunning = false;
                return;
            }

            // Jouer les parties
            for (let gameNum = 1; gameNum <= numGames; gameNum++) {
                // Vérifier si on doit s'arrêter
                if (this.shouldStop) {
                    this.addLog('Arrêt demandé par l\'utilisateur', 'warning');
                    break;
                }

                // Vérifier si en pause
                while (this.stats.isPaused) {
                    await this.sleep(1000);
                }

                this.stats.currentGame = gameNum;
                this.addLog(`=== PARTIE ${gameNum}/${numGames} ===`, 'game');

                // Navigation vers le jeu
                if (!await this.navigateToGame()) {
                    this.addLog(`Échec navigation partie ${gameNum}`, 'error');
                    
                    const currentUrl = this.page.url();
                    if (currentUrl.includes(this.loginUrl)) {
                        this.addLog('Tentative de reconnexion...', 'warning');
                        if (!await this.login()) {
                            this.addLog('Impossible de continuer', 'error');
                            break;
                        }
                        continue;
                    } else {
                        this.addLog('Arrêt du bot', 'error');
                        break;
                    }
                }

                // Jouer
                if (await this.playGame()) {
                    this.stats.gamesSuccessful++;
                    this.addLog(`Partie ${gameNum}/${numGames} réussie`, 'success');

                    // Pause entre parties
                    if (gameNum < numGames) {
                        const pauseTime = 5000;
                        this.addLog(`Pause de ${pauseTime/1000}s...`, 'info');
                        await this.sleep(pauseTime);
                    }
                } else {
                    this.stats.gamesFailed++;
                    this.addLog(`Partie ${gameNum}/${numGames} échouée`, 'error');
                }

                this.stats.gamesPlayed++;
            }

            this.addLog('=== BOT TERMINÉ ===', 'success');
            this.addLog(`Parties réussies: ${this.stats.gamesSuccessful}/${numGames}`, 'success');
            this.stats.isRunning = false;

        } catch (error) {
            this.addLog(`ERREUR FATALE: ${error.message}`, 'error');
            this.stats.isRunning = false;
        } finally {
            if (this.browser) {
                await this.sleep(2000);
                await this.browser.close();
                this.addLog('Navigateur fermé', 'info');
            }
        }
    }

    stop() {
        this.shouldStop = true;
        this.addLog('Arrêt demandé...', 'warning');
    }

    pause() {
        this.stats.isPaused = true;
        this.addLog('Bot en pause', 'warning');
    }

    resume() {
        this.stats.isPaused = false;
        this.addLog('Bot repris', 'success');
    }

    getStats() {
        return {
            ...this.stats,
            uptime: this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0
        };
    }

    getLogs(count = 50) {
        return this.logs.slice(-count);
    }
}

export default MultiGameBot;
