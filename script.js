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
let COOLDOWN_RADIUS = 0; // set in resize
let cooldownZones = []; // {x, y, createdAt, element?}

// Explosion effect
let explosionParticles = [];
let explosionActive = false;
const EXPLOSION_PAUSE_DURATION = 800; // ms to show explosion before game over

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
    COOLDOWN_RADIUS = canvas.width / 12;       // blue zones: diameter = 1/6 width (17% of width)
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Particle class (unchanged except using normalized influence)
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const speed = (5 + Math.random() * 15) * 1.3;  // +30% faster (was 5–17.5 → now 6.5–22.75 px/s)
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

// Explosion particle class
class ExplosionParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const speed = 100 + Math.random() * 200; // Faster particles
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0; // 0 to 1
        this.decay = 0.01 + Math.random() * 0.01; // Slower decay = lasts longer
        this.size = 6 + Math.random() * 8; // Bigger particles
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.vy += 300 * deltaTime; // More gravity
        this.life -= this.decay;
        return this.life > 0;
    }

    draw() {
        const alpha = Math.max(0, this.life);
        // Brighter orange/yellow color
        ctx.fillStyle = `rgba(255, ${Math.floor(150 + 105 * alpha)}, 0, ${alpha})`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = `rgba(255, 200, 0, ${alpha})`;
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
        ctx.shadowBlur = 0;
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

// Create explosion at collision point
function createExplosion(x, y) {
    explosionActive = true;
    explosionParticles = [];
    
    // Create 50-80 explosion particles for a bigger effect
    const count = 50 + Math.floor(Math.random() * 30);
    for (let i = 0; i < count; i++) {
        explosionParticles.push(new ExplosionParticle(x, y));
    }
    
    console.log('Explosion created at', x, y, 'with', count, 'particles');
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
    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    // Always clear and redraw background
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

    // Update game logic only if active
    if (gameActive) {
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

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update(deltaTime);
            if (p.checkWallCollision()) {
                // Create explosion at collision point
                createExplosion(p.x, p.y);
                gameActive = false; // Stop particle updates
                
                // Show explosion for a moment before game over
                setTimeout(() => {
                    explosionActive = false;
                    endGame();
                }, EXPLOSION_PAUSE_DURATION);
                break; // Exit particle loop but continue to draw
            }
            p.draw();
        }
    } else {
        // Game is over but still draw existing particles frozen in place
        particles.forEach(p => p.draw());
    }

    // Draw explosion particles on top of everything if active
    if (explosionActive) {
        console.log('Drawing', explosionParticles.length, 'explosion particles');
        for (let i = explosionParticles.length - 1; i >= 0; i--) {
            const ep = explosionParticles[i];
            if (!ep.update(deltaTime)) {
                explosionParticles.splice(i, 1);
            } else {
                ep.draw();
            }
        }
    }

    requestAnimationFrame(gameLoop);
}

function startGame() {
    gameActive = true;
    particles = [];
    explosionParticles = [];
    explosionActive = false;
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