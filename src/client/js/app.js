const io = require('socket.io-client');

const COLORS = {
    background: '#01030a',
    self: '#ffffff',
    other: 'rgba(255, 255, 255, 0.45)',
    otherStrong: 'rgba(255, 255, 255, 0.7)'
};

const state = {
    mode: null,
    socket: null,
    animationId: null,
    player: null,
    playerId: null,
    users: [],
    target: { x: 0, y: 0 },
    displayName: '',
    playing: false,
    population: 0,
    game: { width: 5000, height: 5000 },
    camera: { x: 0, y: 0 },
    heartbeatId: null,
    cellTrails: []
};

let canvas;
let ctx;
let landingView;
let spaceView;
let modeLabel;
let nameLabel;
let populationLabel;
let statusMessage;
let personalButton;
let globalButton;
let exitButton;
let nameInput;

function setupDomReferences() {
    canvas = document.getElementById('spaceCanvas');
    ctx = canvas.getContext('2d');
    landingView = document.getElementById('landingView');
    spaceView = document.getElementById('spaceView');
    modeLabel = document.getElementById('modeLabel');
    nameLabel = document.getElementById('nameLabel');
    populationLabel = document.getElementById('populationLabel');
    statusMessage = document.getElementById('statusMessage');
    personalButton = document.getElementById('enterPersonal');
    globalButton = document.getElementById('enterGlobal');
    exitButton = document.getElementById('exitView');
    nameInput = document.getElementById('displayNameInput');
}

function generateDisplayName(mode) {
    const fallback = mode === 'personal'
        ? `Explorer-${Math.floor(Math.random() * 900 + 100)}`
        : 'Spectator';
    const typed = (nameInput && nameInput.value || '').trim();
    return typed.length > 0 ? typed : fallback;
}

function setStatus(text) {
    if (!statusMessage) return;
    statusMessage.textContent = text;
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function handleResize() {
    resizeCanvas();
    if (state.socket && state.socket.connected && state.mode === 'personal') {
        state.socket.emit('windowResized', {
            screenWidth: canvas.width,
            screenHeight: canvas.height
        });
    }
}

function resetTarget() {
    state.target.x = 0;
    state.target.y = 0;
}

function handlePointerMove(evt) {
    if (state.mode !== 'personal' || !state.playing) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = evt.clientX !== undefined ? evt.clientX : (evt.touches && evt.touches[0].clientX);
    const clientY = evt.clientY !== undefined ? evt.clientY : (evt.touches && evt.touches[0].clientY);
    if (clientX === undefined || clientY === undefined) return;

    state.target.x = clientX - rect.left - canvas.width / 2;
    state.target.y = clientY - rect.top - canvas.height / 2;

    if (evt.touches) {
        evt.preventDefault();
    }
}

function teardownSocket() {
    stopHeartbeat();
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }
    if (state.socket) {
        if (typeof state.socket.removeAllListeners === 'function') {
            state.socket.removeAllListeners();
        }
        state.socket.disconnect();
        state.socket = null;
    }
    state.playing = false;
    state.player = null;
    state.playerId = null;
    state.users = [];
    state.cellTrails = [];
}

function updateHud() {
    if (modeLabel) {
        modeLabel.textContent = state.mode === 'personal' ? 'Personal' : 'Global';
    }
    if (nameLabel) {
        nameLabel.textContent = state.displayName || '-';
    }
    if (populationLabel) {
        populationLabel.textContent = String(state.population || 0);
    }
}

function ensureView(active) {
    if (!landingView || !spaceView) return;
    if (active) {
        landingView.classList.add('hidden');
        spaceView.classList.remove('hidden');
    } else {
        spaceView.classList.add('hidden');
        landingView.classList.remove('hidden');
    }
}

function startMode(mode) {
    teardownSocket();
    state.mode = mode;
    state.displayName = generateDisplayName(mode);
    resetTarget();
    ensureView(true);
    updateHud();
    resizeCanvas();
    connectSocket();
}

function stopMode() {
    teardownSocket();
    ensureView(false);
    setStatus('대기 중입니다.');
}

function connectSocket() {
    const queryType = state.mode === 'personal' ? 'player' : 'spectator';
    const socket = io({ query: `type=${queryType}` });
    state.socket = socket;
    setStatus('Connecting…');

    socket.on('connect', () => {
        setStatus('Connected. Initialising…');
        if (state.mode === 'personal') {
            socket.emit('respawn');
        }
    });

    socket.on('welcome', (playerSettings = {}, gameSizes = {}) => {
        state.game = {
            width: Number(gameSizes.width) || state.game.width,
            height: Number(gameSizes.height) || state.game.height
        };
        state.player = Object.assign({}, playerSettings);
        if (typeof state.player.x !== 'number') {
            state.player.x = state.game.width / 2;
        }
        if (typeof state.player.y !== 'number') {
            state.player.y = state.game.height / 2;
        }
        state.player.cells = Array.isArray(state.player.cells) ? state.player.cells : [];
        state.playerId = playerSettings.id || state.playerId || socket.id;
        state.camera = {
            x: playerSettings.x || state.game.width / 2,
            y: playerSettings.y || state.game.height / 2
        };
        state.cellTrails = [];

        const handshakePayload = Object.assign({}, playerSettings, {
            name: state.displayName,
            screenWidth: canvas.width,
            screenHeight: canvas.height,
            target: state.target
        });

        if (state.mode !== 'personal') {
            delete handshakePayload.target;
            delete handshakePayload.screenWidth;
            delete handshakePayload.screenHeight;
        }

        socket.emit('gotit', handshakePayload);

        if (state.mode === 'personal') {
            socket.emit('windowResized', {
                screenWidth: canvas.width,
                screenHeight: canvas.height
            });
        }

        state.playing = true;
        setStatus('Connected');
        startAnimationLoop();
        startHeartbeat();
    });

    socket.on('serverTellPlayerMove', (playerData, userData = []) => {
        state.users = Array.isArray(userData) ? userData : [];
        state.population = state.users.length;
        if (populationLabel) {
            populationLabel.textContent = String(state.population);
        }
        if (state.mode === 'personal') {
            state.player = Object.assign({}, state.player, playerData);
            state.player.cells = Array.isArray(state.player.cells) ? state.player.cells : [];
        } else {
            state.camera = {
                x: playerData.x || state.game.width / 2,
                y: playerData.y || state.game.height / 2
            };
        }
    });

    socket.on('leaderboard', (data = {}) => {
        if (data.players !== undefined) {
            state.population = data.players;
            if (populationLabel) {
                populationLabel.textContent = String(state.population);
            }
        }
    });

    socket.on('RIP', () => {
        state.playing = false;
        setStatus('흡수되었습니다. 나가기를 눌러 재접속하세요.');
    });

    socket.on('kick', (reason = '') => {
        state.playing = false;
        setStatus(reason ? `접속이 종료되었습니다: ${reason}` : '접속이 종료되었습니다.');
    });

    socket.on('disconnect', () => {
        if (state.playing) {
            setStatus('연결이 끊어졌습니다.');
        }
        state.playing = false;
        stopHeartbeat();
    });

    socket.on('connect_error', (error) => {
        setStatus(`연결 실패: ${error.message}`);
    });
}

function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatId = setInterval(() => {
        if (!state.playing || !state.socket || !state.socket.connected) return;
        if (state.mode !== 'personal') return;
        state.socket.emit('0', state.target);
    }, 500);
}

function stopHeartbeat() {
    if (state.heartbeatId) {
        clearInterval(state.heartbeatId);
        state.heartbeatId = null;
    }
}
function startAnimationLoop() {
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
    }
    const step = () => {
        drawFrame();
        state.animationId = requestAnimationFrame(step);
    };
    step();
}

function drawFrame() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!state.playing) return;

    if (state.mode === 'personal' && state.player) {
        drawPersonalView();
    } else if (state.mode === 'global') {
        drawGlobalView();
    }
}

function drawPersonalView() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const playerCells = (state.player && state.player.cells) || [];

    recordCellTrails(playerCells);
    const glowTargets = detectCollisionGlow(playerCells);

    if (playerCells.length === 0) {
        ctx.fillStyle = COLORS.self;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    playerCells.forEach((cell, index) => {
        const radius = Math.max(Math.min(cell.radius, 48), 6);
        const screenX = centerX + (cell.x - state.player.x);
        const screenY = centerY + (cell.y - state.player.y);

        drawCellTrail(radius, index, centerX, centerY);
        if (glowTargets.has(index)) {
            drawCollisionGlow(screenX, screenY, radius);
        }
        drawPlayerCell(screenX, screenY, radius);
    });
}

function detectCollisionGlow(playerCells) {
    const glowIndexes = new Set();
    if (!Array.isArray(playerCells) || playerCells.length === 0) return glowIndexes;

    state.users.forEach((user) => {
        if (!user || user.id === state.playerId || !Array.isArray(user.cells)) return;
        user.cells.forEach((otherCell) => {
            playerCells.forEach((cell, index) => {
                if (!cell) return;
                const distance = Math.hypot(otherCell.x - cell.x, otherCell.y - cell.y);
                if (distance <= (otherCell.radius + cell.radius)) {
                    glowIndexes.add(index);
                }
            });
        });
    });

    return glowIndexes;
}

function recordCellTrails(playerCells) {
    if (!Array.isArray(playerCells) || playerCells.length === 0) {
        state.cellTrails = [];
        return;
    }

    if (!Array.isArray(state.cellTrails)) {
        state.cellTrails = [];
    }
    if (state.cellTrails.length > playerCells.length) {
        state.cellTrails.length = playerCells.length;
    }

    playerCells.forEach((cell, index) => {
        let trail = state.cellTrails[index];
        if (!trail) {
            trail = [];
            state.cellTrails[index] = trail;
        }
        const last = trail[trail.length - 1];
        const moved = !last || Math.hypot(cell.x - last.x, cell.y - last.y) > 1;
        if (moved) {
            trail.push({ x: cell.x, y: cell.y });
            if (trail.length > 15) {
                trail.shift();
            }
        } else if (trail.length > 4) {
            trail.shift();
        }
    });
}

function drawCellTrail(radius, trailIndex, centerX, centerY) {
    const trail = state.cellTrails[trailIndex];
    if (!trail || trail.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = trail.length - 1; i > 0; i--) {
        const current = trail[i];
        const previous = trail[i - 1];
        const startX = centerX + (current.x - state.player.x);
        const startY = centerY + (current.y - state.player.y);
        const endX = centerX + (previous.x - state.player.x);
        const endY = centerY + (previous.y - state.player.y);
        const strength = i / trail.length;
        ctx.strokeStyle = `rgba(120, 180, 255, ${0.15 + strength * 0.35})`;
        ctx.lineWidth = Math.max(radius * 0.25 * strength, 1.5);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
    ctx.restore();
}

function drawCollisionGlow(x, y, radius) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const outerRadius = radius + 24;
    const gradient = ctx.createRadialGradient(x, y, radius * 0.6, x, y, outerRadius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
    gradient.addColorStop(1, 'rgba(255, 220, 120, 0.55)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawPlayerCell(x, y, radius) {
    ctx.save();
    const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(1, COLORS.self);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(radius * 0.12, 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
    ctx.restore();
}

function drawGlobalView() {
    const scale = Math.min(
        canvas.width / state.game.width,
        canvas.height / state.game.height
    );
    const offsetX = (canvas.width - state.game.width * scale) / 2;
    const offsetY = (canvas.height - state.game.height * scale) / 2;

    ctx.strokeStyle = COLORS.otherStrong;
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, state.game.width * scale, state.game.height * scale);

    ctx.fillStyle = COLORS.other;
    state.users.forEach((user) => {
        if (!user || !Array.isArray(user.cells)) return;
        user.cells.forEach((cell) => {
            const radius = Math.max(cell.radius * scale, 2);
            ctx.beginPath();
            ctx.arc(offsetX + cell.x * scale, offsetY + cell.y * scale, radius, 0, Math.PI * 2);
            ctx.fill();
        });
    });
}

function bindEvents() {
    if (personalButton) {
        personalButton.addEventListener('click', () => startMode('personal'));
    }
    if (globalButton) {
        globalButton.addEventListener('click', () => startMode('global'));
    }
    if (exitButton) {
        exitButton.addEventListener('click', stopMode);
    }
    if (canvas) {
        canvas.addEventListener('mousemove', handlePointerMove);
        canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
        canvas.addEventListener('mouseleave', resetTarget);
        canvas.addEventListener('touchend', resetTarget);
    }
    window.addEventListener('resize', handleResize);
}

document.addEventListener('DOMContentLoaded', () => {
    setupDomReferences();
    resizeCanvas();
    bindEvents();
    setStatus('대기 중입니다.');
});
