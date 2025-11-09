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
    cellTrails: [],
    collisionPairs: new Map(), // Stores collision pairs: "userId1:cellIndex1-userId2:cellIndex2" -> { user1, cellIndex1, user2, cellIndex2 }
    collisionMarks: [], // Stores collision marks: { x, y, timestamp, radius }
    lastCollisionMarkTimes: new Map() // Stores last collision mark time for each pair to avoid spam
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
    state.collisionPairs.clear();
    state.collisionMarks = [];
    state.lastCollisionMarkTimes.clear();
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
        const newPlayerId = playerSettings.id || socket.id;
        
        // Clear collision pairs involving the player (player respawned with new cells)
        if (state.playerId) {
            const keysToRemove = [];
            state.collisionPairs.forEach((pair, key) => {
                if (pair.userId1 === state.playerId || pair.userId2 === state.playerId) {
                    keysToRemove.push(key);
                }
            });
            keysToRemove.forEach(key => state.collisionPairs.delete(key));
        }
        
        state.player = Object.assign({}, playerSettings);
        if (typeof state.player.x !== 'number') {
            state.player.x = state.game.width / 2;
        }
        if (typeof state.player.y !== 'number') {
            state.player.y = state.game.height / 2;
        }
        state.player.cells = Array.isArray(state.player.cells) ? state.player.cells : [];
        state.playerId = newPlayerId;
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

function cleanupCollisionPairs() {
    // Remove pairs where users or cells no longer exist
    const validUserIds = new Set(state.users.map(u => u && u.id).filter(Boolean));
    if (state.playerId) {
        validUserIds.add(state.playerId);
    }

    const keysToRemove = [];
    state.collisionPairs.forEach((pair, key) => {
        const user1Valid = validUserIds.has(pair.userId1);
        const user2Valid = validUserIds.has(pair.userId2);
        
        if (!user1Valid || !user2Valid) {
            keysToRemove.push(key);
            return;
        }

        // Check if cells still exist
        let cell1Exists = false;
        let cell2Exists = false;

        if (pair.userId1 === state.playerId && state.player && state.player.cells) {
            cell1Exists = pair.cellIndex1 < state.player.cells.length && state.player.cells[pair.cellIndex1];
        } else {
            const user1 = state.users.find(u => u && u.id === pair.userId1);
            if (user1 && user1.cells) {
                cell1Exists = pair.cellIndex1 < user1.cells.length && user1.cells[pair.cellIndex1];
            }
        }

        if (pair.userId2 === state.playerId && state.player && state.player.cells) {
            cell2Exists = pair.cellIndex2 < state.player.cells.length && state.player.cells[pair.cellIndex2];
        } else {
            const user2 = state.users.find(u => u && u.id === pair.userId2);
            if (user2 && user2.cells) {
                cell2Exists = pair.cellIndex2 < user2.cells.length && user2.cells[pair.cellIndex2];
            }
        }

        if (!cell1Exists || !cell2Exists) {
            keysToRemove.push(key);
        }
    });

    keysToRemove.forEach(key => state.collisionPairs.delete(key));
}

function getCellPosition(userId, cellIndex) {
    if (userId === state.playerId && state.player && state.player.cells) {
        const cell = state.player.cells[cellIndex];
        if (cell) {
            return { x: cell.x, y: cell.y, radius: cell.radius };
        }
    } else {
        const user = state.users.find(u => u && u.id === userId);
        if (user && user.cells && user.cells[cellIndex]) {
            const cell = user.cells[cellIndex];
            return { x: cell.x, y: cell.y, radius: cell.radius };
        }
    }
    return null;
}

function drawCollisionLines() {
    cleanupCollisionPairs();

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;

    state.collisionPairs.forEach((pair) => {
        const cell1 = getCellPosition(pair.userId1, pair.cellIndex1);
        const cell2 = getCellPosition(pair.userId2, pair.cellIndex2);

        if (!cell1 || !cell2) return;

        let x1, y1, x2, y2;

        if (state.mode === 'personal') {
            // Personal view: convert world coordinates to screen coordinates
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            x1 = centerX + (cell1.x - state.player.x);
            y1 = centerY + (cell1.y - state.player.y);
            x2 = centerX + (cell2.x - state.player.x);
            y2 = centerY + (cell2.y - state.player.y);
        } else {
            // Global view: scale to canvas
            const scale = Math.min(
                canvas.width / state.game.width,
                canvas.height / state.game.height
            );
            const offsetX = (canvas.width - state.game.width * scale) / 2;
            const offsetY = (canvas.height - state.game.height * scale) / 2;
            x1 = offsetX + cell1.x * scale;
            y1 = offsetY + cell1.y * scale;
            x2 = offsetX + cell2.x * scale;
            y2 = offsetY + cell2.y * scale;
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    });

    ctx.restore();
}

function drawPersonalView() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const playerCells = (state.player && state.player.cells) || [];

    recordCellTrails(playerCells);
    const glowTargets = detectCollisionGlow(playerCells);

    // Draw collision lines first (behind balls)
    drawCollisionLines();

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

function getCollisionPairKey(userId1, cellIndex1, userId2, cellIndex2) {
    // Normalize pair key so A-B and B-A are treated the same
    const [id1, idx1, id2, idx2] = userId1 < userId2 || (userId1 === userId2 && cellIndex1 < cellIndex2)
        ? [userId1, cellIndex1, userId2, cellIndex2]
        : [userId2, cellIndex2, userId1, cellIndex1];
    return `${id1}:${idx1}-${id2}:${idx2}`;
}

function addCollisionMark(x, y, radius, pairKey) {
    // Only add marks in global view
    if (state.mode !== 'global') return;
    
    const now = Date.now();
    const MIN_MARK_INTERVAL = 300; // Minimum 300ms between marks for the same pair
    
    // Check if we recently added a mark for this pair
    if (pairKey) {
        const lastTime = state.lastCollisionMarkTimes.get(pairKey);
        if (lastTime && (now - lastTime) < MIN_MARK_INTERVAL) {
            return; // Skip if too soon
        }
        state.lastCollisionMarkTimes.set(pairKey, now);
    }
    
    // Calculate mark position (midpoint between colliding cells)
    const mark = {
        x: x,
        y: y,
        timestamp: now,
        radius: Math.max(radius, 20) // Minimum radius for visibility
    };
    state.collisionMarks.push(mark);
}

function detectCollisionGlow(playerCells) {
    const glowIndexes = new Set();
    const hasPlayerCells = Array.isArray(playerCells) && playerCells.length > 0;

    // Check collisions between player cells and other users' cells
    if (hasPlayerCells && state.playerId) {
        state.users.forEach((user) => {
            if (!user || user.id === state.playerId || !Array.isArray(user.cells)) return;
            user.cells.forEach((otherCell, otherCellIndex) => {
                playerCells.forEach((cell, index) => {
                    if (!cell) return;
                    const distance = Math.hypot(otherCell.x - cell.x, otherCell.y - cell.y);
                    if (distance <= (otherCell.radius + cell.radius)) {
                        glowIndexes.add(index);
                        // Record collision pair (for line drawing)
                        const pairKey = getCollisionPairKey(state.playerId, index, user.id, otherCellIndex);
                        if (!state.collisionPairs.has(pairKey)) {
                            state.collisionPairs.set(pairKey, {
                                userId1: state.playerId,
                                cellIndex1: index,
                                userId2: user.id,
                                cellIndex2: otherCellIndex
                            });
                        }
                        // Add collision mark at midpoint (always, even if pair already exists)
                        const midX = (cell.x + otherCell.x) / 2;
                        const midY = (cell.y + otherCell.y) / 2;
                        const avgRadius = (cell.radius + otherCell.radius) / 2;
                        addCollisionMark(midX, midY, avgRadius, pairKey);
                    }
                });
            });
        });
    }

    // Check collisions between all users' cells (including player if not in personal mode)
    const allUsers = state.playerId && state.player && state.player.cells 
        ? [{ id: state.playerId, cells: state.player.cells }, ...state.users]
        : state.users;
    
    for (let i = 0; i < allUsers.length; i++) {
        const user1 = allUsers[i];
        if (!user1 || !Array.isArray(user1.cells)) continue;
        for (let j = i + 1; j < allUsers.length; j++) {
            const user2 = allUsers[j];
            if (!user2 || !Array.isArray(user2.cells)) continue;
            user1.cells.forEach((cell1, cellIndex1) => {
                if (!cell1) return;
                user2.cells.forEach((cell2, cellIndex2) => {
                    if (!cell2) return;
                    const distance = Math.hypot(cell2.x - cell1.x, cell2.y - cell1.y);
                    if (distance <= (cell1.radius + cell2.radius)) {
                        // Record collision pair (for line drawing)
                        const pairKey = getCollisionPairKey(user1.id, cellIndex1, user2.id, cellIndex2);
                        if (!state.collisionPairs.has(pairKey)) {
                            state.collisionPairs.set(pairKey, {
                                userId1: user1.id,
                                cellIndex1: cellIndex1,
                                userId2: user2.id,
                                cellIndex2: cellIndex2
                            });
                        }
                        // Add collision mark at midpoint (always, even if pair already exists)
                        const midX = (cell1.x + cell2.x) / 2;
                        const midY = (cell1.y + cell2.y) / 2;
                        const avgRadius = (cell1.radius + cell2.radius) / 2;
                        addCollisionMark(midX, midY, avgRadius, pairKey);
                    }
                });
            });
        }
    }

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

function updateCollisionMarks() {
    const now = Date.now();
    const MARK_LIFETIME = 15000; // 15 seconds total lifetime
    const FADE_START = 10000; // Start fading after 10 seconds
    
    // Remove expired marks and update alpha
    state.collisionMarks = state.collisionMarks.filter((mark) => {
        const age = now - mark.timestamp;
        if (age >= MARK_LIFETIME) {
            return false; // Remove expired marks
        }
        return true;
    });
}

function drawCollisionMarks() {
    if (state.mode !== 'global' || state.collisionMarks.length === 0) return;
    
    const scale = Math.min(
        canvas.width / state.game.width,
        canvas.height / state.game.height
    );
    const offsetX = (canvas.width - state.game.width * scale) / 2;
    const offsetY = (canvas.height - state.game.height * scale) / 2;
    
    const now = Date.now();
    const MARK_LIFETIME = 15000; // 15 seconds total lifetime
    const FADE_START = 10000; // Start fading after 10 seconds
    
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    state.collisionMarks.forEach((mark) => {
        const age = now - mark.timestamp;
        if (age >= MARK_LIFETIME) return;
        
        // Calculate alpha based on age
        let alpha = 1.0;
        if (age > FADE_START) {
            // Fade out from FADE_START to MARK_LIFETIME
            const fadeProgress = (age - FADE_START) / (MARK_LIFETIME - FADE_START);
            alpha = 1.0 - fadeProgress;
        }
        
        const screenX = offsetX + mark.x * scale;
        const screenY = offsetY + mark.y * scale;
        const screenRadius = mark.radius * scale;
        
        // Draw glow effect similar to collision glow
        const outerRadius = screenRadius * 2.5;
        const gradient = ctx.createRadialGradient(
            screenX, screenY, screenRadius * 0.3,
            screenX, screenY, outerRadius
        );
        gradient.addColorStop(0, `rgba(255, 220, 120, ${0.8 * alpha})`);
        gradient.addColorStop(0.5, `rgba(255, 200, 100, ${0.4 * alpha})`);
        gradient.addColorStop(1, `rgba(255, 180, 80, ${0.0 * alpha})`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenX, screenY, outerRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw inner bright core
        const coreGradient = ctx.createRadialGradient(
            screenX, screenY, 0,
            screenX, screenY, screenRadius * 0.6
        );
        coreGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * alpha})`);
        coreGradient.addColorStop(1, `rgba(255, 220, 120, ${0.3 * alpha})`);
        
        ctx.fillStyle = coreGradient;
        ctx.beginPath();
        ctx.arc(screenX, screenY, screenRadius * 0.6, 0, Math.PI * 2);
        ctx.fill();
    });
    
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

    // Update collision pairs for global view (detect collisions between all users)
    detectCollisionGlow(state.player && state.player.cells ? state.player.cells : []);

    // Update and draw collision marks (behind everything)
    updateCollisionMarks();
    drawCollisionMarks();

    // Draw collision lines (behind balls)
    drawCollisionLines();

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
