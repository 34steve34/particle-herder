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

// Set canvas size
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    DEAD_ZONE_RADIUS = canvas.width / 4;  // 50% width diameter
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Particle class
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

        const maxDistance = Math.max(canvas.width, canvas.height) * 0.6;
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

// High scores
function getHighScores() {
    const scores = localStorage.getItem('particleHerderScores');
    return scores ? JSON.parse(scores) : [];
}

function saveHighScore(time) {
    let scores = getHighScores();
    scores.push(time);
    scores.sort((a, b) => b - a);
    scores = scores.slice(0, 5);
    localStorage.setItem('particleHerderScores', JSON.stringify(scores));
    return scores;
}

function displayHighScores(scores) {
    highScoresDisplay.innerHTML = '<strong>TOP SCORES:</strong><br>' + 
        scores.map((score, index) => `<div>${index + 1}. ${score.toFixed(1)}s</div>`).join('');
}

// Tap effect (reverted to original quick pulse)
function showTapEffect(x, y) {
    const rect = canvas.getBoundingClientRect();
    tapEffect.style.left = (x - 20) + 'px';
    tapEffect.style.top = (y - 20) + 'px';
    tapEffect.style.display = 'block';
    tapEffect.style.animation = 'none';
    setTimeout(() => {
        tapEffect.style.animation = 'tapPulse 0.3s ease-out';
    }, 10);
    // Hide immediately after animation (original behavior)
    setTimeout(() => {
        tapEffect.style.display = 'none';
    }, 300);
}

// Handle tap/click
function handleTap(e) {
    if (!gameActive) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let tapX, tapY;
    if (e.type.startsWith('touch')) {
        tapX = (e.touches[0].clientX - rect.left) * scaleX;
        tapY = (e.touches[0].clientY - rect.top) * scaleY;
        showTapEffect(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
    } else {
        tapX = (e.clientX - rect.left) * scaleX;
        tapY = (e.clientY - rect.top) * scaleY;
        showTapEffect(e.clientX - rect.left, e.clientY - rect.top);
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const distanceFromCenter = Math.sqrt((tapX - centerX) ** 2 + (tapY - centerY) ** 2);
    if (distanceFromCenter <= DEAD_ZONE_RADIUS) return;

    if (isPaused) pausedTime += CLICK_PAUSE_DURATION;
    isPaused = true;
    lastPauseStart = performance.now();
    setTimeout(() => {
        if (isPaused) {
            pausedTime += CLICK_PAUSE_DURATION;
            isPaused = false;
        }
    }, CLICK_PAUSE_DURATION);

    particles.forEach(p => p.applyTapInfluence(tapX, tapY));
}

canvas.addEventListener('click', handleTap);
canvas.addEventListener('touchstart', handleTap);

// Game loop
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
    timerDisplay.textContent = (currentTime / 1000).toFixed(1) + 's';

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

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(WALL_MARGIN, 0); ctx.lineTo(WALL_MARGIN, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(canvas.width - WALL_MARGIN, 0); ctx.lineTo(canvas.width - WALL_MARGIN, canvas.height); ctx.stroke();

    ctx.strokeStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, DEAD_ZONE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

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
    startTime = performance.now();
    lastSpawnTime = startTime;
    lastFrameTime = startTime;
    pausedTime = 0;
    isPaused = false;
    gameOverScreen.classList.remove('show');

    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * DEAD_ZONE_RADIUS;
    const spawnX = canvas.width / 2 + Math.cos(angle) * distance;
    const spawnY = canvas.height / 2 + Math.sin(angle) * distance;
    particles.push(new Particle(spawnX, spawnY));

    requestAnimationFrame(gameLoop);
}

function endGame() {
    gameActive = false;
    const finalTime = currentTime / 1000;
    finalScoreDisplay.textContent = finalTime.toFixed(1);
    const highScores = saveHighScore(finalTime);
    displayHighScores(highScores);
    gameOverScreen.classList.add('show');
}

restartBtn.addEventListener('click', startGame);

startGame();