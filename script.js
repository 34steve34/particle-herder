const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const timerDisplay = document.getElementById('timer');
const gameOverScreen = document.getElementById('gameOver');
const finalScoreDisplay = document.getElementById('finalScore');
const highScoresDisplay = document.getElementById('highScores');
const restartBtn = document.getElementById('restartBtn');
const tapEffect = document.getElementById('tapEffect');

// Game state
let gameActive = false;
let particles = [];
let startTime = 0;
let currentTime = 0;
let lastSpawnTime = 0;
let pausedTime = 0;
let lastPauseStart = 0;
let isPaused = false;
const SPAWN_INTERVAL = 700;
const PARTICLE_SIZE = 4;
const WALL_MARGIN = 20;
let DEAD_ZONE_RADIUS = 0;
const CLICK_PAUSE_DURATION = 300;
const COOLDOWN_DURATION = 4000; // 4 seconds
const COOLDOWN_RADIUS = 0; // set in resize
let cooldownZones = []; // {x, y, createdAt, element?}

// Force portrait orientation hint (best-effort)
if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {});
}

// Set canvas size + cooldown radius
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    DEAD_ZONE_RADIUS = canvas.width / 4;           // red center = 50% width diameter
    COOLDOWN_RADIUS = canvas.width / 5;            // blue zones = 1/5 width radius = 20% width diameter
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Particle class (unchanged except using normalized influence)
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const speed = 5 + Math.random() * 12.5;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        if (this.y < 0) this.y = canvas.height;
        else if (this.y > canvas.height) this.y = 0;
    }

    draw() {
        ctx.fillStyle = '#fff';
        ctx.fillRect(this.x - PARTICLE_SIZE / 2, this.y - PARTICLE_SIZE / 2, PARTICLE_SIZE, PARTICLE_SIZE);
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#fff';
        ctx.fillRect(this.x - PARTICLE_SIZE / 2, this.y - PARTICLE_SIZE / 2, PARTICLE_SIZE, PARTICLE_SIZE);
        ctx.shadowBlur = 0;
    }

    checkWallCollision() {
        return this.x <= WALL_MARGIN || this.x >= canvas.width - WALL_MARGIN;
    }

    applyTapInfluence(tapX, tapY) {
        const dx = tapX - this.x;
        const dy = tapY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1) return;

        const diagonal = Math.sqrt(canvas.width**2 + canvas.height**2);
        const maxDistance = diagonal * 0.4;
        const influenceStrength = Math.max(0, 1 - Math.pow(distance / maxDistance, 1.5));
        const turnFactor = influenceStrength * 0.45;

        const targetAngle = Math.atan2(dy, dx);
        const currentAngle = Math.atan2(this.vy, this.vx);
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const newAngle = currentAngle + angleDiff * turnFactor;

        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        this.vx = Math.cos(newAngle) * speed;
        this.vy = Math.sin(newAngle) * speed;
    }
}

// High scores (unchanged)
function getHighScores() {
    const scores = localStorage.getItem('particleHerderScores');
    return scores ? JSON.parse(scores) : [];
}

function saveHighScore(timeMs) {
    const score = Math.floor(timeMs / 100);
    let scores = getHighScores();
    scores.push(score);
    scores.sort((a, b) => b - a);
    scores = scores.slice(0, 5);
    localStorage.setItem('particleHerderScores', JSON.stringify(scores));
    return scores;
}

function displayHighScores(scores) {
    highScoresDisplay.innerHTML = '<strong>TOP SCORES:</strong><br>' + 
        scores.map((score, index) => `<div>${index + 1}. ${score}</div>`).join('');
}

// Tap effect (white pulse)
function showTapEffect(x, y) {
    const rect = canvas.getBoundingClientRect();
    tapEffect.style.left = (x - 20) + 'px';
    tapEffect.style.top = (y - 20) + 'px';
    tapEffect.style.display = 'block';
    tapEffect.style.animation = 'none';
    setTimeout(() => tapEffect.style.animation = 'tapPulse 0.3s ease-out', 10);
    setTimeout(() => tapEffect.style.display = 'none', 300);
}

// Create blue cooldown outline
function createCooldownZone(x, y) {
    const zone = document.createElement('div');
    zone.className = 'cooldown-zone';
    zone.style.left = (x - COOLDOWN_RADIUS) + 'px';
    zone.style.top = (y - COOLDOWN_RADIUS) + 'px';
    zone.style.width = (COOLDOWN_RADIUS * 2) + 'px';
    zone.style.height = (COOLDOWN_RADIUS * 2) + 'px';
    document.getElementById('gameContainer').appendChild(zone);

    const createdAt = performance.now();
    cooldownZones.push({x, y, createdAt, element: zone});

    // Auto-remove after duration
    setTimeout(() => {
        if (zone.parentNode) zone.remove();
        cooldownZones = cooldownZones.filter(z => z.createdAt !== createdAt);
    }, COOLDOWN_DURATION);
}

// Check if tap is inside any active cooldown zone
function isInCooldownZone(tapX, tapY) {
    const now = performance.now();
    for (const zone of cooldownZones) {
        if (now - zone.createdAt > COOLDOWN_DURATION) continue;
        const dx = tapX - zone.x;
        const dy = tapY - zone.y;
        if (Math.sqrt(dx*dx + dy*dy) <= COOLDOWN_RADIUS) {
            return true;
        }
    }
    return false;
}

// Handle tap/click
function handleTap(e) {
    if (!gameActive) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let tapX, tapY, clientX, clientY;
    if (e.type.startsWith('touch')) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        tapX = (clientX - rect.left) * scaleX;
        tapY = (clientY - rect.top) * scaleY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
        tapX = (clientX - rect.left) * scaleX;
        tapY = (clientY - rect.top) * scaleY;
    }

    showTapEffect(clientX - rect.left, clientY - rect.top);

    // Check central dead zone
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const distToCenter = Math.sqrt((tapX - centerX)**2 + (tapY - centerY)**2);
    if (distToCenter <= DEAD_ZONE_RADIUS) return;

    // Check blue cooldown zones
    if (isInCooldownZone(tapX, tapY)) {
        // Still pause timer even if influence is blocked
        if (isPaused) pausedTime += CLICK_PAUSE_DURATION;
        isPaused = true;
        lastPauseStart = performance.now();
        setTimeout(() => {
            if (isPaused) {
                pausedTime += CLICK_PAUSE_DURATION;
                isPaused = false;
            }
        }, CLICK_PAUSE_DURATION);
        return;
    }

    // Apply influence + pause + create blue zone
    particles.forEach(p => p.applyTapInfluence(tapX, tapY));

    if (isPaused) pausedTime += CLICK_PAUSE_DURATION;
    isPaused = true;
    lastPauseStart = performance.now();
    setTimeout(() => {
        if (isPaused) {
            pausedTime += CLICK_PAUSE_DURATION;
            isPaused = false;
        }
    }, CLICK_PAUSE_DURATION);

    createCooldownZone(tapX, tapY);
}

canvas.addEventListener('click', handleTap);
canvas.addEventListener('touchstart', handleTap);

// Game loop (add drawing of blue zones is handled via DOM elements above)
let lastFrameTime = 0;

function gameLoop(timestamp) {
    if (!gameActive) {
        requestAnimationFrame(gameLoop);
        return;
    }

    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    if (isPaused) {
        const pauseDuration = performance.now() - lastPauseStart;
        if (pauseDuration <= CLICK_PAUSE_DURATION) {
            currentTime = timestamp - startTime - pausedTime - pauseDuration;
        }
    } else {
        currentTime = timestamp - startTime - pausedTime;
    }
    const score = Math.floor(currentTime / 100);
    timerDisplay.textContent = `SCORE: ${score}`;

    if (timestamp - lastSpawnTime >= SPAWN_INTERVAL) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * DEAD_ZONE_RADIUS;
        const spawnX = canvas.width / 2 + Math.cos(angle) * distance;
        const spawnY = canvas.height / 2 + Math.sin(angle) * distance;
        particles.push(new Particle(spawnX, spawnY));
        lastSpawnTime = timestamp;
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Walls
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(WALL_MARGIN, 0); ctx.lineTo(WALL_MARGIN, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(canvas.width - WALL_MARGIN, 0); ctx.lineTo(canvas.width - WALL_MARGIN, canvas.height); ctx.stroke();

    // Red center
    ctx.strokeStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, DEAD_ZONE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update(deltaTime);
        if (p.checkWallCollision()) {
            endGame();
            return;
        }
        p.draw();
    }

    requestAnimationFrame(gameLoop);
}

function startGame() {
    gameActive = true;
    particles = [];
    cooldownZones.forEach(z => z.element?.remove());
    cooldownZones = [];
    startTime = performance.now();
    lastSpawnTime = startTime;
    lastFrameTime = startTime;
    pausedTime = 0;
    isPaused = false;
    gameOverScreen.classList.remove('show');
    timerDisplay.textContent = 'SCORE: 0';

    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * DEAD_ZONE_RADIUS;
    const spawnX = canvas.width / 2 + Math.cos(angle) * distance;
    const spawnY = canvas.height / 2 + Math.sin(angle) * distance;
    particles.push(new Particle(spawnX, spawnY));

    requestAnimationFrame(gameLoop);
}

function endGame() {
    gameActive = false;
    const finalScore = Math.floor(currentTime / 100);
    finalScoreDisplay.textContent = finalScore;
    const highScores = saveHighScore(currentTime);
    displayHighScores(highScores);
    gameOverScreen.classList.add('show');
}

restartBtn.addEventListener('click', startGame);

startGame();