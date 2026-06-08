const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Asset Handling ---
const images = { frog: new Image(), monster: new Image() };
images.frog.src = 'images/frog.png';
images.monster.src = 'images/monster.png';

// --- YOUTUBE CUTSCENE CONFIGURATION ---
const cutscenes = {
    3: { id: 'z-o8T5K2eD0', start: 35, end: 55 }, 
    6: { id: 'z-o8T5K2eD0', start: 67, end: 83 }, 
    9: { id: 'z-o8T5K2eD0', start: 126, end: 150 }  
};

let ytPlayer;
let ytReady = false;

// Inject the official YouTube API into the page
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        playerVars: { 'controls': 0, 'disablekb': 1, 'fs': 0, 'rel': 0, 'modestbranding': 1 },
        events: {
            'onReady': () => ytReady = true,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerStateChange(event) {
    if (gameState === 'CUTSCENE' && (event.data === YT.PlayerState.ENDED || event.data === YT.PlayerState.PAUSED)) {
        endCutscene();
    }
}

let assetsLoaded = 0;
const totalAssets = 2; 
function assetLoaded() {
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
        drawMenu();
        fetchGlobalLeaderboardsSilent(); // Silently grab scores so we know if they hit Top 5 upon death
    }
}
images.frog.onload = assetLoaded;
images.monster.onload = assetLoaded;

// --- 8-Bit Audio Engine ---
let audioCtx;
let isMuted = false;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(frequency, type, duration) {
    if (!audioCtx || isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; 
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playMunch() { playTone(880, 'square', 0.1); } 
function playWrong() { playTone(150, 'sawtooth', 0.4); } 
function playSpawn() { playTone(300, 'square', 0.2); } 
function playChomp() { 
    playTone(200, 'sawtooth', 0.2); 
    setTimeout(() => playTone(150, 'sawtooth', 0.2), 100); 
}
function playLevelComplete() {
    playTone(440, 'square', 0.1);
    setTimeout(() => playTone(554, 'square', 0.1), 100);
    setTimeout(() => playTone(659, 'square', 0.2), 200);
}

// --- Game Constants & State ---
const GRID_COLS = 6;
const GRID_ROWS = 5;
const CELL_WIDTH = 100;
const CELL_HEIGHT = 80;
const GRID_OFFSET_Y = 100; 

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzH9u7Owl-7HphVQyl1xLkEn-pTxRR1kPqIuGVjIMNX5uzVZwyR9Oils-fYLVXTy01v/exec'; 

let gameState = 'MENU'; 
let level = 1;
let score = 0;
let lives = 3; 
let entryReason = 'win'; // Tracks if they are entering name for 'win' or 'highscore'

let gameStartTime = 0;
let finalTimeSeconds = 0;
let playerName = "";
let globalLeaderboardData = { immaculateBoard: [], generalBoard: [], bestScoreBoard: [] };

let deathMessage = "";
let deathTime = 0;
let deathPlayerPos = { x: 0, y: 0 };
let eatingAnimations = []; 

// 3 Monsters in final two levels
const levelConfig = [
    { target: 8,   monsters: 1, speed: 2000 }, 
    { target: 10,  monsters: 1, speed: 2000 }, 
    { target: 15,  monsters: 1, speed: 2000 }, 
    { target: 24,  monsters: 2, speed: 1000 }, 
    { target: 36,  monsters: 2, speed: 1000 }, 
    { target: 48,  monsters: 2, speed: 1000 }, 
    { target: 60,  monsters: 2, speed: 500  }, 
    { target: 72,  monsters: 2, speed: 500  }, 
    { target: 90,  monsters: 3, speed: 500  }, 
    { target: 100, monsters: 3, speed: 500  }  
];

let player = { x: 2, y: 2 }; 
let gridData = []; 
let monsters = [];
let lastMonsterMoveTime = 0;
let pausedAt = 0; 

// --- Math & Grid Logic ---
function getFactors(num) {
    let factors = [];
    for (let i = 1; i <= num; i++) if (num % i === 0) factors.push(i);
    return factors;
}

function randomizeCell(r, c) {
    const config = levelConfig[level - 1];
    const factors = getFactors(config.target);
    if (Math.random() < 0.3) {
        gridData[r][c] = factors[Math.floor(Math.random() * factors.length)];
    } else {
        let randomNum = Math.floor(Math.random() * config.target) + 1;
        while (factors.includes(randomNum)) randomNum = Math.floor(Math.random() * config.target) + 1;
        gridData[r][c] = randomNum;
    }
}

function generateGrid() {
    gridData = [];
    for (let r = 0; r < GRID_ROWS; r++) {
        let row = [];
        for (let c = 0; c < GRID_COLS; c++) row.push(null);
        gridData.push(row);
    }
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) randomizeCell(r, c);
    }
    resetEntities();
}

function getRandomSpawn(index) {
    if (level === 1) {
        return { x: -1 - (index * 2), y: Math.floor(Math.random() * GRID_ROWS), dx: 1, dy: 0, warned: false, state: 'active' };
    }

    const side = Math.floor(Math.random() * 4);
    const stagger = index * 2;

    if (side === 0) { 
        return { x: -1 - stagger, y: Math.floor(Math.random() * GRID_ROWS), dx: 1, dy: 0, warned: false, state: 'active' };
    } else if (side === 1) { 
        return { x: GRID_COLS + stagger, y: Math.floor(Math.random() * GRID_ROWS), dx: -1, dy: 0, warned: false, state: 'active' };
    } else if (side === 2) { 
        return { x: Math.floor(Math.random() * GRID_COLS), y: -1 - stagger, dx: 0, dy: 1, warned: false, state: 'active' };
    } else { 
        return { x: Math.floor(Math.random() * GRID_COLS), y: GRID_ROWS + stagger, dx: 0, dy: -1, warned: false, state: 'active' };
    }
}

function resetEntities() {
    const config = levelConfig[level - 1];
    monsters = [];
    for (let i = 0; i < config.monsters; i++) {
        monsters.push(getRandomSpawn(i));
    }
    player = { x: 2, y: 2 };
    eatingAnimations = [];
}

// --- Leaderboard Sync Logic ---
function formatTime(seconds) {
    let m = Math.floor(seconds / 60);
    let s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Silently updates data in the background so the game knows Top 5 scores without interrupting play
function fetchGlobalLeaderboardsSilent() {
    fetch(SCRIPT_URL)
        .then(res => res.json())
        .then(data => { 
            if (!data.bestScoreBoard) data.bestScoreBoard = []; 
            globalLeaderboardData = data; 
        })
        .catch(err => console.error("Silent API error", err));
}

function fetchGlobalLeaderboards() {
    gameState = 'LOADING_DATA';
    fetch(SCRIPT_URL)
        .then(res => res.json())
        .then(data => { 
            if (!data.bestScoreBoard) data.bestScoreBoard = [];
            globalLeaderboardData = data; 
            gameState = 'LEADERBOARD'; 
        })
        .catch(err => { console.error("API error", err); gameState = 'LEADERBOARD'; });
}

function saveScoreToSheets() {
    let boardType = 'generalBoard';
    if (entryReason === 'win' && lives === 3) boardType = 'immaculateBoard';
    if (entryReason === 'highscore') boardType = 'bestScoreBoard';

    gameState = 'LOADING_DATA';
    fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ name: playerName || "ANON", time: finalTimeSeconds, score: score, boardType: boardType }) 
    })
    .then(res => res.json()).then(() => fetchGlobalLeaderboards())
    .catch(() => fetchGlobalLeaderboards());
}

// --- Game Flow & Video Integration ---
function startCutscene(lvl) {
    if (!ytReady || !cutscenes[lvl]) {
        proceedToNextLevel();
        return;
    }
    
    gameState = 'CUTSCENE';
    document.getElementById('video-overlay').style.display = 'block';
    document.getElementById('skip-btn').style.display = 'block';

    const scene = cutscenes[lvl];
    ytPlayer.loadVideoById({
        videoId: scene.id,
        startSeconds: scene.start,
        endSeconds: scene.end
    });
}

function endCutscene() {
    if (gameState !== 'CUTSCENE') return;
    ytPlayer.stopVideo();
    document.getElementById('video-overlay').style.display = 'none';
    document.getElementById('skip-btn').style.display = 'none';
    proceedToNextLevel();
}

document.getElementById('skip-btn').addEventListener('click', endCutscene);

function proceedToNextLevel() {
    level++;
    generateGrid();
    gameState = 'BOARD_REVEAL';
    setTimeout(() => {
        gameState = 'PLAYING';
        lastMonsterMoveTime = performance.now();
    }, 1000);
}

function checkLevelComplete() {
    const config = levelConfig[level - 1];
    let factors = getFactors(config.target);
    let factorsLeft = false;

    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (gridData[r][c] !== null && factors.includes(gridData[r][c])) factorsLeft = true;
        }
    }

    if (factorsLeft === false) {
        playLevelComplete(); 
        if (level >= 10) {
            finalTimeSeconds = Math.floor((performance.now() - gameStartTime) / 1000);
            playerName = ""; 
            entryReason = 'win';
            gameState = 'NAME_ENTRY';
        } else {
            gameState = 'LEVEL_TRANSITION';
            setTimeout(() => {
                if (level === 3 || level === 6 || level === 9) {
                    startCutscene(level); 
                } else {
                    proceedToNextLevel(); 
                }
            }, 2000); 
        }
    }
}

function handleDeath(reason, num1, num2) {
    playWrong(); 
    deathTime = performance.now();
    deathPlayerPos = { x: player.x, y: player.y };
    deathMessage = reason === 'wrong_factor' ? `${num1} is NOT a factor of ${num2}!` : "CHOMP! You got caught!";
    gameState = 'PLAYER_DIED';
    lives--;

    setTimeout(() => {
        if (lives <= 0) {
            // Check for High Score Qualification before Game Over
            let isHighScore = false;
            let bestScores = globalLeaderboardData.bestScoreBoard || [];
            if (score > 0 && (bestScores.length < 5 || score > bestScores[bestScores.length - 1].score)) {
                isHighScore = true;
            }

            if (isHighScore) {
                playerName = "";
                entryReason = 'highscore';
                finalTimeSeconds = Math.floor((performance.now() - gameStartTime) / 1000);
                gameState = 'NAME_ENTRY';
            } else {
                gameState = 'GAME_OVER';
                setTimeout(() => { gameState = 'MENU'; lives = 3; score = 0; level = 1; }, 3000);
            }
        } else {
            resetEntities();
            gameState = 'PLAYING';
            lastMonsterMoveTime = performance.now();
        }
    }, 2000);
}

function checkCollisions() {
    for (let m of monsters) {
        if (m.state === 'active' && m.x === player.x && m.y === player.y) { handleDeath('eaten'); return; }
    }
}

// --- Monster AI & Updates ---
function updateMonsters(timestamp) {
    const config = levelConfig[level - 1];
    let timeUntilNextMove = (lastMonsterMoveTime + config.speed) - timestamp;
    
    for (let i = 0; i < monsters.length; i++) {
        let m = monsters[i];
        if (m.state === 'respawning' && timestamp > m.respawnTime) {
            let newSpawn = getRandomSpawn(0);
            m.x = newSpawn.x; m.y = newSpawn.y;
            m.dx = newSpawn.dx; m.dy = newSpawn.dy;
            m.state = 'active'; m.warned = false;
        } else if (m.state === 'active') {
            let isAtBorder = (m.x === -1 || m.x === GRID_COLS || m.y === -1 || m.y === GRID_ROWS);
            if (isAtBorder && !m.warned && timeUntilNextMove <= 1000) { playSpawn(); m.warned = true; }
        }
    }

    if (timestamp - lastMonsterMoveTime > config.speed) {
        for (let i = 0; i < monsters.length; i++) {
            let m = monsters[i];
            if (m.state !== 'active') continue;

            let isOffScreen = (m.x < 0 || m.x >= GRID_COLS || m.y < 0 || m.y >= GRID_ROWS);
            
            if (isOffScreen) {
                m.x += m.dx;
                m.y += m.dy;
                if (m.x < -1 || m.x > GRID_COLS || m.y < -1 || m.y > GRID_ROWS) {
                    m.state = 'respawning';
                    m.respawnTime = timestamp + 1000 + Math.random() * 2000;
                }
            } else {
                if (level < 4) {
                    m.x += m.dx;
                    m.y += m.dy;
                    if (m.x < 0 || m.x >= GRID_COLS || m.y < 0 || m.y >= GRID_ROWS) {
                        m.state = 'respawning';
                        m.respawnTime = timestamp + 1000 + Math.random() * 2000;
                    }
                } else {
                    let dirs = [{dx:0,dy:-1}, {dx:0,dy:1}, {dx:-1,dy:0}, {dx:1,dy:0}];
                    let leaveDirs = dirs.filter(d => m.x + d.dx < 0 || m.x + d.dx >= GRID_COLS || m.y + d.dy < 0 || m.y + d.dy >= GRID_ROWS);
                    let stayDirs = dirs.filter(d => m.x + d.dx >= 0 && m.x + d.dx < GRID_COLS && m.y + d.dy >= 0 && m.y + d.dy < GRID_ROWS);
                    
                    let move;
                    if (leaveDirs.length > 0 && Math.random() < 0.1) move = leaveDirs[Math.floor(Math.random() * leaveDirs.length)];
                    else move = stayDirs[Math.floor(Math.random() * stayDirs.length)];
                    
                    m.x += move.dx; m.y += move.dy;
                    
                    if (m.x < 0 || m.x >= GRID_COLS || m.y < 0 || m.y >= GRID_ROWS) {
                        m.dx = move.dx;
                        m.dy = move.dy;
                    }
                }
            }
            
            if (m.state === 'active' && m.x >= 0 && m.x < GRID_COLS && m.y >= 0 && m.y < GRID_ROWS && gridData[m.y][m.x] !== null) {
                let totalFactorsLeft = 0;
                let factors = getFactors(config.target);
                for (let r = 0; r < GRID_ROWS; r++) {
                    for (let c = 0; c < GRID_COLS; c++) {
                        if (gridData[r][c] !== null && factors.includes(gridData[r][c])) totalFactorsLeft++;
                    }
                }
                if (totalFactorsLeft === 1 && factors.includes(gridData[m.y][m.x])) {
                    gridData[m.y][m.x] = factors[Math.floor(Math.random() * factors.length)];
                } else {
                    randomizeCell(m.y, m.x);
                }
            }
        }
        
        for (let i = 0; i < monsters.length; i++) {
            for (let j = i + 1; j < monsters.length; j++) {
                let m1 = monsters[i];
                let m2 = monsters[j];
                if (m1.state === 'active' && m2.state === 'active' && 
                    m1.x === m2.x && m1.y === m2.y && 
                    m1.x >= 0 && m1.x < GRID_COLS && m1.y >= 0 && m1.y < GRID_ROWS) {
                    
                    m2.state = 'respawning';
                    m2.respawnTime = timestamp + 3000 + Math.random() * 2000; 
                    
                    eatingAnimations.push({ x: m1.x, y: m1.y, expires: timestamp + 500 });
                    playChomp();
                }
            }
        }

        checkCollisions();
        lastMonsterMoveTime = timestamp;
    }
}

// --- Drawing Functions ---
function drawMenu() {
    if (assetsLoaded < totalAssets) return;
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFF'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('MATH MUNCHERS', canvas.width / 2, 120);
    ctx.drawImage(images.frog, (canvas.width / 2) - 100, 150, 80, 80);
    ctx.drawImage(images.monster, (canvas.width / 2) + 20, 150, 80, 80);
    ctx.fillStyle = '#FFFF00'; ctx.font = '20px Courier New'; ctx.fillText('HOW TO PLAY:', canvas.width / 2, 280);
    ctx.fillStyle = '#FFF'; ctx.font = '18px Courier New'; 
    ctx.fillText('Arrow Keys to Move', canvas.width / 2, 310);
    ctx.fillText('Spacebar to Munch Factors', canvas.width / 2, 340);
    ctx.fillStyle = '#00FF00'; ctx.font = '22px Courier New'; ctx.fillText('Press ENTER to Start', canvas.width / 2, 420);
    ctx.fillStyle = '#AAA'; ctx.font = '16px Courier New'; ctx.fillText('Press L to view Hall of Fame', canvas.width / 2, 470);
    ctx.fillText(`Audio: ${isMuted ? 'MUTED' : 'ON'} (Press M to toggle)`, canvas.width / 2, 530);
}

function drawTransition() {
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00FF00'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('LEVEL COMPLETE!', canvas.width / 2, canvas.height / 2);
}

function drawNameEntry() {
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Dynamically change the title based on WHY they are entering their name
    if (entryReason === 'highscore') {
        ctx.fillStyle = '#FF00FF'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('NEW HIGH SCORE!', canvas.width / 2, 100);
        ctx.fillStyle = '#FFF'; ctx.font = '20px Courier New';
        ctx.fillText(`You reached Level ${level}`, canvas.width / 2, 140);
    } else {
        ctx.fillStyle = '#FFFF00'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('YOU WIN!', canvas.width / 2, 100);
        ctx.fillStyle = '#FFF'; ctx.font = '20px Courier New';
        ctx.fillText(`Final Time: ${formatTime(finalTimeSeconds)}`, canvas.width / 2, 140);
        ctx.fillText(`Lives Remaining: ${lives}`, canvas.width / 2, 170);
    }

    ctx.fillStyle = '#00FFFF'; ctx.font = '24px Courier New';
    ctx.fillText(`Final Score: ${score}`, canvas.width / 2, 220);

    ctx.fillStyle = '#00FF00'; ctx.font = '20px Courier New'; 
    ctx.fillText('ENTER YOUR NAME (Max 8 letters):', canvas.width / 2, 280);
    ctx.strokeStyle = '#FFF'; ctx.strokeRect(canvas.width / 2 - 100, 310, 200, 50);
    ctx.fillStyle = '#FFF'; ctx.font = '30px Courier New';
    ctx.fillText(playerName + (Math.floor(Date.now() / 500) % 2 === 0 ? '_' : ''), canvas.width / 2, 345);
    ctx.font = '16px Courier New'; ctx.fillStyle = '#AAA';
    ctx.fillText('Press ENTER to transmit score', canvas.width / 2, 400);
}

function drawLoading() {
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFF'; ctx.font = '30px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('COMMUNICATING...', canvas.width / 2, canvas.height / 2);
}

function drawLeaderboards() {
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFF'; ctx.font = '30px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('GLOBAL HALL OF FAME', canvas.width / 2, 50);
    
    // Top Left: Immaculate
    ctx.font = '20px Courier New';
    ctx.fillStyle = '#FFFF00'; ctx.fillText('IMMACULATE (3 Lives)', canvas.width / 4, 100);
    ctx.fillStyle = '#FFF';
    for (let i = 0; i < 5; i++) {
        let entry = globalLeaderboardData.immaculateBoard[i];
        let text = entry ? `${i+1}. ${entry.name.padEnd(8, ' ')} - ${formatTime(entry.time)}` : `${i+1}. ---`;
        ctx.fillText(text, canvas.width / 4, 140 + (i * 30));
    }
    
    // Top Right: General Clear
    ctx.fillStyle = '#00FF00'; ctx.fillText('GENERAL CLEAR', (canvas.width / 4) * 3, 100);
    ctx.fillStyle = '#FFF';
    for (let i = 0; i < 5; i++) {
        let entry = globalLeaderboardData.generalBoard[i];
        let text = entry ? `${i+1}. ${entry.name.padEnd(8, ' ')} - ${formatTime(entry.time)}` : `${i+1}. ---`;
        ctx.fillText(text, (canvas.width / 4) * 3, 140 + (i * 30));
    }

    // Bottom Center: Best Score
    ctx.fillStyle = '#FF00FF'; ctx.fillText('BEST SCORES', canvas.width / 2, 330);
    ctx.fillStyle = '#FFF';
    for (let i = 0; i < 5; i++) {
        let entry = (globalLeaderboardData.bestScoreBoard && globalLeaderboardData.bestScoreBoard[i]) ? globalLeaderboardData.bestScoreBoard[i] : null;
        let text = entry ? `${i+1}. ${entry.name.padEnd(8, ' ')} - ${entry.score} PTS` : `${i+1}. ---`;
        ctx.fillText(text, canvas.width / 2, 370 + (i * 30));
    }

    ctx.fillStyle = '#AAA'; ctx.font = '16px Courier New';
    ctx.fillText('Press ENTER to return', canvas.width / 2, canvas.height - 30);
}

function drawGameOver() {
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FF0000'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
}

function drawPause() {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFF'; ctx.font = '40px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    ctx.font = '20px Courier New'; ctx.fillText('Press P to Resume', canvas.width / 2, canvas.height / 2 + 40);
    ctx.fillStyle = '#AAA'; ctx.font = '16px Courier New'; ctx.fillText('Press ESC to Quit Game', canvas.width / 2, canvas.height / 2 + 90);
}

function drawGame() {
    const config = levelConfig[level - 1];
    let currentTime = performance.now();
    ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#FFF'; ctx.font = '20px Courier New'; ctx.textAlign = 'left';
    ctx.fillText(`Level: ${level}`, 20, 40); ctx.textAlign = 'center';
    ctx.fillText(`Factors of ${config.target}`, canvas.width / 2, 40);
    
    ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 2; ctx.textBaseline = 'middle';
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            let x = c * CELL_WIDTH, y = r * CELL_HEIGHT + GRID_OFFSET_Y;
            ctx.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT);
            if (gridData[r][c] !== null) {
                ctx.fillStyle = '#FFF'; ctx.fillText(gridData[r][c], x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2);
            }
            if (player.x === c && player.y === r && gameState !== 'PLAYER_DIED') {
                ctx.drawImage(images.frog, x + 10, y + 5, CELL_WIDTH - 20, CELL_HEIGHT - 10);
            }
        }
    }
    
    for (let m of monsters) {
        if (m.state === 'active') {
            // FIX: Only draw the monster if it is inside the grid boundaries
            if (m.x >= 0 && m.x < GRID_COLS && m.y >= 0 && m.y < GRID_ROWS) {
                let x = m.x * CELL_WIDTH, y = m.y * CELL_HEIGHT + GRID_OFFSET_Y;
                ctx.drawImage(images.monster, x + 5, y, CELL_WIDTH - 10, CELL_HEIGHT);
            }
        }
    }

    eatingAnimations = eatingAnimations.filter(anim => currentTime < anim.expires);
    for (let anim of eatingAnimations) {
        let x = anim.x * CELL_WIDTH, y = anim.y * CELL_HEIGHT + GRID_OFFSET_Y;
        ctx.save();
        ctx.translate(x + CELL_WIDTH/2, y + CELL_HEIGHT/2);
        let scale = 1 + (anim.expires - currentTime) / 500; 
        ctx.scale(scale, scale);
        ctx.drawImage(images.monster, -CELL_WIDTH/2 + 5, -CELL_HEIGHT/2, CELL_WIDTH - 10, CELL_HEIGHT);
        ctx.fillStyle = '#FF0000'; ctx.font = 'bold 20px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('CHOMP!', 0, -CELL_HEIGHT/2 - 5);
        ctx.restore();
    }
    
    ctx.fillStyle = '#FFF'; ctx.textAlign = 'left'; ctx.font = '20px Courier New';
    ctx.fillText(`Score: ${score}`, 20, canvas.height - 50);
    ctx.textAlign = 'center'; ctx.fillStyle = '#FFFF00'; ctx.font = '16px Courier New';
    ctx.fillText('P:Pause | ESC:Quit | M:Mute', canvas.width / 2, canvas.height - 20);
    if (isMuted) { ctx.fillStyle = '#FF0000'; ctx.fillText('MUTED', canvas.width / 2, canvas.height - 50); }
    ctx.textAlign = 'left'; ctx.fillStyle = '#FFF'; ctx.font = '20px Courier New';
    ctx.fillText('Lives:', canvas.width - 200, canvas.height - 50);
    for (let i = 0; i < lives; i++) {
        let startX = canvas.width - 120;
        ctx.drawImage(images.frog, startX + (i * 35), canvas.height - 72, 30, 30);
    }
    
    if (gameState === 'PLAYER_DIED') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        let progress = Math.min((currentTime - deathTime) / 1000, 1); 
        let cx = deathPlayerPos.x * CELL_WIDTH + CELL_WIDTH / 2;
        let cy = deathPlayerPos.y * CELL_HEIGHT + GRID_OFFSET_Y + CELL_HEIGHT / 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(progress * Math.PI * 6); 
        let scale = Math.max(0, 1 - progress); ctx.scale(scale, scale);
        ctx.drawImage(images.frog, -(CELL_WIDTH - 20)/2, -(CELL_HEIGHT - 10)/2, CELL_WIDTH - 20, CELL_HEIGHT - 10);
        ctx.restore();
        ctx.fillStyle = '#FF0000'; ctx.font = 'bold 36px Courier New'; ctx.textAlign = 'center';
        ctx.fillText('OUCH! LIFE LOST', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillStyle = '#FFFF00'; ctx.font = '20px Courier New';
        ctx.fillText(deathMessage, canvas.width / 2, canvas.height / 2 + 20);
    }
}

// --- Game Loop ---
function gameLoop(timestamp) {
    if (gameState === 'MENU') drawMenu();
    else if (gameState === 'LEVEL_TRANSITION') drawTransition();
    else if (gameState === 'NAME_ENTRY') drawNameEntry();
    else if (gameState === 'LOADING_DATA') drawLoading();
    else if (gameState === 'LEADERBOARD') drawLeaderboards();
    else if (gameState === 'GAME_OVER') drawGameOver();
    else if (gameState === 'PAUSED') drawPause();
    else if (gameState === 'CUTSCENE') { /* Wait for video */ } 
    else if (gameState === 'BOARD_REVEAL' || gameState === 'PLAYER_DIED') drawGame(); 
    else if (gameState === 'PLAYING') { updateMonsters(timestamp); drawGame(); }
    requestAnimationFrame(gameLoop);
}

// --- Input Handling ---
window.addEventListener('keydown', (e) => {
    initAudio(); 
    
    if (gameState === 'CUTSCENE') {
        if (e.key === 'Escape' || e.key === 'Enter') endCutscene();
        return; 
    }
    
    if(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) > -1) {
        if (gameState !== 'NAME_ENTRY') e.preventDefault();
    }

    if (e.key === 'm' || e.key === 'M') { isMuted = !isMuted; return; }

    if (e.key === 'Escape') {
        if (gameState === 'PLAYING' || gameState === 'PAUSED' || gameState === 'PLAYER_DIED' || gameState === 'BOARD_REVEAL') {
            gameState = 'MENU'; level = 1; score = 0; lives = 3; return;
        }
    }

    if (gameState === 'MENU' && (e.key === 'l' || e.key === 'L')) { fetchGlobalLeaderboards(); return; }
    if (gameState === 'LEADERBOARD') { if (e.key === 'Enter') gameState = 'MENU'; return; }

    if (gameState === 'NAME_ENTRY') {
        if (e.key === 'Enter' && playerName.length > 0) saveScoreToSheets();
        else if (e.key === 'Backspace') playerName = playerName.slice(0, -1);
        else if (e.key.length === 1 && playerName.length < 8 && /[a-zA-Z0-9]/.test(e.key)) playerName += e.key.toUpperCase();
        return;
    }

    if (e.key === 'p' || e.key === 'P') {
        if (gameState === 'PLAYING') { gameState = 'PAUSED'; pausedAt = performance.now(); } 
        else if (gameState === 'PAUSED') { lastMonsterMoveTime += (performance.now() - pausedAt); gameState = 'PLAYING'; }
        return; 
    }

    if (gameState === 'MENU' && e.key === 'Enter') {
        level = 1; score = 0; lives = 3; generateGrid(); gameState = 'BOARD_REVEAL';
        setTimeout(() => { gameState = 'PLAYING'; gameStartTime = performance.now(); lastMonsterMoveTime = performance.now(); }, 1000);
    } else if (gameState === 'PLAYING') {
        if (e.key === 'ArrowUp' && player.y > 0) player.y--;
        if (e.key === 'ArrowDown' && player.y < GRID_ROWS - 1) player.y++;
        if (e.key === 'ArrowLeft' && player.x > 0) player.x--;
        if (e.key === 'ArrowRight' && player.x < GRID_COLS - 1) player.x++;
        checkCollisions(); 
        
        if (e.key === ' ') {
            let munchedNumber = gridData[player.y][player.x];
            if (munchedNumber !== null) {
                const config = levelConfig[level - 1]; 
                let factors = getFactors(config.target);
                if (factors.includes(munchedNumber)) {
                    playMunch(); score += 100; gridData[player.y][player.x] = null; checkLevelComplete(); 
                } else { 
                    handleDeath('wrong_factor', munchedNumber, config.target); 
                }
            }
        }
    }
});

requestAnimationFrame(gameLoop);