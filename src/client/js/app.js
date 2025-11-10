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
    lastCollisionMarkTimes: new Map(), // Stores last collision mark time for each pair to avoid spam
    lastKnownUserPositions: new Map() // Stores last known positions of users for persistent lines in personal view
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
    state.lastKnownUserPositions.clear();
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
        // Track all user IDs that have ever been seen (for persistent collision tracking)
        const previousUserIds = new Set(state.users.map(u => u && u.id).filter(Boolean));
        
        state.users = Array.isArray(userData) ? userData : [];
        const currentUserIds = new Set(state.users.map(u => u && u.id).filter(Boolean));
        state.population = state.users.length;
        if (populationLabel) {
            populationLabel.textContent = String(state.population);
        }
        
        // Update last known positions for persistent lines in personal view
        // Now that server sends actual positions for collision pairs, we just store the data
        if (state.mode === 'personal') {
            const currentTime = Date.now();
            // Update positions for users that are in the current update
            // Server now sends collision pair users even when off-screen, so we get real positions
            state.users.forEach((user) => {
                if (user && user.id && user.cells && user.cells.length > 0) {
                    // Store the center position of the user's cells
                    let sumX = 0, sumY = 0;
                    user.cells.forEach(cell => {
                        if (cell) {
                            sumX += cell.x;
                            sumY += cell.y;
                        }
                    });
                    const centerX = sumX / user.cells.length;
                    const centerY = sumY / user.cells.length;
                    
                    // Store actual position from server (no prediction needed)
                    state.lastKnownUserPositions.set(user.id, {
                        x: centerX,
                        y: centerY,
                        cells: user.cells.map(c => ({ x: c.x, y: c.y, radius: c.radius })),
                        lastSeen: currentTime
                    });
                }
            });
            
            // Clean up users that are no longer in the game
            // If a user is not in current update and has no collision pairs, they might have disconnected
            const DISCONNECT_TIMEOUT = 60000; // 1 minute timeout for users not in collision pairs
            state.lastKnownUserPositions.forEach((pos, userId) => {
                if (userId !== state.playerId && !currentUserIds.has(userId)) {
                    // Check if user has active collision pairs
                    let hasActiveCollisionPair = false;
                    state.collisionPairs.forEach((pair) => {
                        if (pair.userId1 === userId || pair.userId2 === userId) {
                            hasActiveCollisionPair = true;
                        }
                    });
                    
                    if (!hasActiveCollisionPair) {
                        // User without collision pairs - remove after timeout
                        const timeSinceLastSeen = currentTime - (pos.lastSeen || currentTime);
                        if (timeSinceLastSeen > DISCONNECT_TIMEOUT) {
                            state.lastKnownUserPositions.delete(userId);
                        }
                    }
                    // Users with collision pairs should stay - server will send their positions
                    // If server stops sending, it means they disconnected, and we'll handle it in cleanupCollisionPairs
                }
            });
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
        
        // Send collision pairs tracking info to server
        // This ensures server sends position updates for collision pairs even when off-screen
        if (state.collisionPairs && state.collisionPairs.size > 0) {
            const trackedUserIds = new Set();
            state.collisionPairs.forEach((pair) => {
                // Only track other users (not player)
                if (pair.userId1 === state.playerId && pair.userId2 !== state.playerId) {
                    trackedUserIds.add(pair.userId2);
                } else if (pair.userId2 === state.playerId && pair.userId1 !== state.playerId) {
                    trackedUserIds.add(pair.userId1);
                }
            });
            
            // Send tracked user IDs to server
            if (trackedUserIds.size > 0) {
                state.socket.emit('trackCollisionPairs', Array.from(trackedUserIds));
            }
        }
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
    // For personal view, keep collision pairs permanently until user explicitly disconnects
    if (state.mode === 'personal') {
        // Remove pairs only if player has no cells (player died/respawned)
        if (!state.player || !state.player.cells || state.player.cells.length === 0) {
            const keysToRemove = [];
            state.collisionPairs.forEach((pair, key) => {
                if (pair.userId1 === state.playerId || pair.userId2 === state.playerId) {
                    keysToRemove.push(key);
                }
            });
            keysToRemove.forEach(key => state.collisionPairs.delete(key));
        }
        
        // DO NOT remove pairs based on state.users - users might be off-screen
        // Pairs are only removed when user explicitly disconnects (handled in serverTellPlayerMove)
        // If lastKnownUserPositions exists for a user, they are still in the game (just off-screen)
        // So we keep the collision pairs as long as lastKnownUserPositions exists
        
        return;
    }

    // For global view, use the original cleanup logic
    const validUserIds = new Set(state.users.map(u => u && u.id).filter(Boolean));
    if (state.playerId) {
        validUserIds.add(state.playerId);
    }

    const keysToRemove = [];
    state.collisionPairs.forEach((pair, key) => {
        const user1Valid = validUserIds.has(pair.userId1);
        const user2Valid = validUserIds.has(pair.userId2);
        
        // Remove if either user no longer exists
        if (!user1Valid || !user2Valid) {
            keysToRemove.push(key);
            return;
        }

        // Check specific cell indices for global view
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
        // For player, try to get the specific cell, or fall back to first/largest cell
        if (cellIndex >= 0 && cellIndex < state.player.cells.length) {
            const cell = state.player.cells[cellIndex];
            if (cell) {
                return { x: cell.x, y: cell.y, radius: cell.radius };
            }
        }
        // Fall back to first cell or largest cell
        if (state.player.cells.length > 0) {
            const cell = state.player.cells[0];
            return { x: cell.x, y: cell.y, radius: cell.radius };
        }
    } else {
        const user = state.users.find(u => u && u.id === userId);
        if (user && user.cells) {
            // Try to get the specific cell
            if (cellIndex >= 0 && cellIndex < user.cells.length) {
                const cell = user.cells[cellIndex];
                if (cell) {
                    return { x: cell.x, y: cell.y, radius: cell.radius };
                }
            }
            // Fall back to first cell or largest cell
            if (user.cells.length > 0) {
                const cell = user.cells[0];
                return { x: cell.x, y: cell.y, radius: cell.radius };
            }
        }
    }
    return null;
}

function getNearestCellToPlayer(userId, referenceX, referenceY) {
    // Get the cell that is closest to the reference point (for personal view)
    if (userId === state.playerId && state.player && state.player.cells) {
        if (state.player.cells.length > 0) {
            // For player, return the cell closest to reference point (usually player center)
            let nearest = state.player.cells[0];
            let minDist = Math.hypot(nearest.x - referenceX, nearest.y - referenceY);
            for (let i = 1; i < state.player.cells.length; i++) {
                const cell = state.player.cells[i];
                const dist = Math.hypot(cell.x - referenceX, cell.y - referenceY);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = cell;
                }
            }
            return { x: nearest.x, y: nearest.y, radius: nearest.radius };
        }
    } else {
        const user = state.users.find(u => u && u.id === userId);
        if (user && user.cells && user.cells.length > 0) {
            // For other users, return the cell closest to reference point
            // This ensures the line always points to the nearest part of the other user
            let nearest = user.cells[0];
            let minDist = Math.hypot(nearest.x - referenceX, nearest.y - referenceY);
            for (let i = 1; i < user.cells.length; i++) {
                const cell = user.cells[i];
                const dist = Math.hypot(cell.x - referenceX, cell.y - referenceY);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = cell;
                }
            }
            return { x: nearest.x, y: nearest.y, radius: nearest.radius };
        }
    }
    return null;
}

function getNearestCellsBetweenUsers(userId1, userId2) {
    // Get the pair of cells (one from each user) that are closest to each other
    // This is better for drawing lines between users
    // For personal view, ALWAYS try lastKnownUserPositions first if user is not in state.users
    // This ensures lines persist for off-screen users
    let user1, user2;
    
    // Get user1 data - prioritize current state, fallback to lastKnownUserPositions
    if (userId1 === state.playerId) {
        if (!state.player || !state.player.cells || state.player.cells.length === 0) {
            return null;
        }
        user1 = { id: state.playerId, cells: state.player.cells };
    } else {
        // First try current users
        user1 = state.users.find(u => u && u.id === userId1);
        
        // If not found and in personal view, use lastKnownUserPositions
        // Server now sends actual positions for collision pairs, so no prediction needed
        if (!user1 && state.mode === 'personal') {
            const lastKnown = state.lastKnownUserPositions.get(userId1);
            if (lastKnown && lastKnown.cells && lastKnown.cells.length > 0) {
                // Use actual position from server (no prediction)
                user1 = { 
                    id: userId1, 
                    cells: lastKnown.cells.map(c => ({
                        x: c.x,
                        y: c.y,
                        radius: c.radius || 10
                    }))
                };
            }
        }
    }
    
    // Get user2 data - prioritize current state, fallback to lastKnownUserPositions
    if (userId2 === state.playerId) {
        if (!state.player || !state.player.cells || state.player.cells.length === 0) {
            return null;
        }
        user2 = { id: state.playerId, cells: state.player.cells };
    } else {
        // First try current users
        user2 = state.users.find(u => u && u.id === userId2);
        
        // If not found and in personal view, use lastKnownUserPositions
        // Server now sends actual positions for collision pairs, so no prediction needed
        if (!user2 && state.mode === 'personal') {
            const lastKnown = state.lastKnownUserPositions.get(userId2);
            if (lastKnown && lastKnown.cells && lastKnown.cells.length > 0) {
                // Use actual position from server (no prediction)
                user2 = { 
                    id: userId2, 
                    cells: lastKnown.cells.map(c => ({
                        x: c.x,
                        y: c.y,
                        radius: c.radius || 10
                    }))
                };
            }
        }
    }
    
    if (!user1 || !user1.cells || user1.cells.length === 0) return null;
    if (!user2 || !user2.cells || user2.cells.length === 0) return null;
    
    let nearest1 = user1.cells[0];
    let nearest2 = user2.cells[0];
    let minDist = Math.hypot(nearest2.x - nearest1.x, nearest2.y - nearest1.y);
    
    // Find the closest pair of cells
    for (let i = 0; i < user1.cells.length; i++) {
        const cell1 = user1.cells[i];
        if (!cell1) continue;
        for (let j = 0; j < user2.cells.length; j++) {
            const cell2 = user2.cells[j];
            if (!cell2) continue;
            const dist = Math.hypot(cell2.x - cell1.x, cell2.y - cell1.y);
            if (dist < minDist) {
                minDist = dist;
                nearest1 = cell1;
                nearest2 = cell2;
            }
        }
    }
    
    return {
        cell1: { x: nearest1.x, y: nearest1.y, radius: nearest1.radius || 10 },
        cell2: { x: nearest2.x, y: nearest2.y, radius: nearest2.radius || 10 }
    };
}

function drawCollisionLines() {
    cleanupCollisionPairs();

    if (state.collisionPairs.size === 0) return;

    ctx.save();
    
    state.collisionPairs.forEach((pair) => {
        let cell1, cell2;
        let isPlayerCell1 = false;
        let isPlayerCell2 = false;

        if (state.mode === 'personal') {
            // For personal view, use nearest cells between users for better persistence
            isPlayerCell1 = (pair.userId1 === state.playerId);
            isPlayerCell2 = (pair.userId2 === state.playerId);
            
            // For personal view, only draw lines from player's cells to other cells
            // Skip if neither cell belongs to player
            if (!isPlayerCell1 && !isPlayerCell2) return;
            
            // Check if player has cells
            if (!state.player || !state.player.cells || state.player.cells.length === 0) {
                return; // Skip if player has no cells
            }
            
            const otherUserId = isPlayerCell1 ? pair.userId2 : pair.userId1;
            
            // For personal view, ALWAYS ensure we have lastKnownUserPositions for the other user
            // This is critical for persistent lines when user goes off-screen
            const lastKnown = state.lastKnownUserPositions.get(otherUserId);
            if (!lastKnown) {
                // Try to get from current state.users and save it
                const currentUser = state.users.find(u => u && u.id === otherUserId);
                if (currentUser && currentUser.cells && currentUser.cells.length > 0) {
                    let sumX = 0, sumY = 0;
                    currentUser.cells.forEach(c => {
                        if (c) {
                            sumX += c.x;
                            sumY += c.y;
                        }
                    });
                    const centerX = sumX / currentUser.cells.length;
                    const centerY = sumY / currentUser.cells.length;
                    state.lastKnownUserPositions.set(otherUserId, {
                        x: centerX,
                        y: centerY,
                        cells: currentUser.cells.map(c => ({ x: c.x, y: c.y, radius: c.radius })),
                        lastSeen: Date.now()
                    });
                }
            }
            
            // Try to get the nearest pair of cells between the two users
            // This will use lastKnownUserPositions if user is off-screen
            let nearestCells = getNearestCellsBetweenUsers(pair.userId1, pair.userId2);
            
            if (!nearestCells) {
                // If getNearestCellsBetweenUsers failed, try using lastKnownUserPositions directly
                const lastKnown = state.lastKnownUserPositions.get(otherUserId);
                
                if (!lastKnown || !lastKnown.cells || lastKnown.cells.length === 0) {
                    // No last known position - this can happen if user was just added to collision pairs
                    // but hasn't been seen in server updates yet
                    // Try to get from state.users one more time as fallback
                    const fallbackUser = state.users.find(u => u && u.id === otherUserId);
                    if (fallbackUser && fallbackUser.cells && fallbackUser.cells.length > 0) {
                        // Save to lastKnownUserPositions for future use
                        let sumX = 0, sumY = 0;
                        fallbackUser.cells.forEach(c => {
                            if (c) {
                                sumX += c.x;
                                sumY += c.y;
                            }
                        });
                        const centerX = sumX / fallbackUser.cells.length;
                        const centerY = sumY / fallbackUser.cells.length;
                        const now = Date.now();
                        
                        // Store actual position from server (no prediction needed)
                        state.lastKnownUserPositions.set(otherUserId, {
                            x: centerX,
                            y: centerY,
                            cells: fallbackUser.cells.map(c => ({ x: c.x, y: c.y, radius: c.radius })),
                            lastSeen: now
                        });
                        // Retry getNearestCellsBetweenUsers now that we have the data
                        nearestCells = getNearestCellsBetweenUsers(pair.userId1, pair.userId2);
                        if (nearestCells) {
                            if (isPlayerCell1) {
                                cell1 = nearestCells.cell1;
                                cell2 = nearestCells.cell2;
                            } else {
                                cell1 = nearestCells.cell2;
                                cell2 = nearestCells.cell1;
                                [isPlayerCell1, isPlayerCell2] = [isPlayerCell2, isPlayerCell1];
                            }
                        } else {
                            return; // Still can't get cells
                        }
                    } else {
                        // No data available at all - skip this line
                        return;
                    }
                } else {
                    // Use player's nearest cell and other user's last known nearest cell
                    // Server now sends actual positions for collision pairs, so use real data
                    const centerX = lastKnown.x;
                    const centerY = lastKnown.y;
                    
                    // Find player's cell closest to other user's position
                    let playerCell = state.player.cells[0];
                    let minDist = Math.hypot(centerX - playerCell.x, centerY - playerCell.y);
                    for (let i = 1; i < state.player.cells.length; i++) {
                        const cell = state.player.cells[i];
                        const dist = Math.hypot(centerX - cell.x, centerY - cell.y);
                        if (dist < minDist) {
                            minDist = dist;
                            playerCell = cell;
                        }
                    }
                    
                    // Find other user's cell closest to player from last known cells (actual positions from server)
                    let otherCell = {
                        x: lastKnown.cells[0].x,
                        y: lastKnown.cells[0].y,
                        radius: lastKnown.cells[0].radius || 10
                    };
                    minDist = Math.hypot(otherCell.x - playerCell.x, otherCell.y - playerCell.y);
                    for (let i = 1; i < lastKnown.cells.length; i++) {
                        const cell = lastKnown.cells[i];
                        const dist = Math.hypot(cell.x - playerCell.x, cell.y - playerCell.y);
                        if (dist < minDist) {
                            minDist = dist;
                            otherCell = {
                                x: cell.x,
                                y: cell.y,
                                radius: cell.radius || 10
                            };
                        }
                    }
                    
                    if (isPlayerCell1) {
                        cell1 = { x: playerCell.x, y: playerCell.y, radius: playerCell.radius };
                        cell2 = otherCell;
                    } else {
                        cell1 = otherCell;
                        cell2 = { x: playerCell.x, y: playerCell.y, radius: playerCell.radius };
                        [isPlayerCell1, isPlayerCell2] = [isPlayerCell2, isPlayerCell1];
                    }
                }
            } else {
                // Ensure cell1 is player's cell and cell2 is other user's cell
                if (isPlayerCell1) {
                    cell1 = nearestCells.cell1;
                    cell2 = nearestCells.cell2;
                } else {
                    // Swap so player cell is first
                    cell1 = nearestCells.cell2;
                    cell2 = nearestCells.cell1;
                    [isPlayerCell1, isPlayerCell2] = [isPlayerCell2, isPlayerCell1];
                }
                
                // Always update lastKnownUserPositions when we have fresh data
                // This ensures we have the latest position even if user goes off-screen
                if (cell2) {
                    const otherUserId = isPlayerCell1 ? pair.userId2 : pair.userId1;
                    const currentLastKnown = state.lastKnownUserPositions.get(otherUserId);
                    
                    // Update lastKnownUserPositions with current cell data
                    // Store all cells, not just one
                    const otherUser = isPlayerCell1 
                        ? (pair.userId2 === state.playerId ? state.player : state.users.find(u => u && u.id === pair.userId2))
                        : (pair.userId1 === state.playerId ? state.player : state.users.find(u => u && u.id === pair.userId1));
                    
                    if (otherUser && otherUser.cells && otherUser.cells.length > 0) {
                        // We have fresh data - update with all cells
                        let sumX = 0, sumY = 0;
                        otherUser.cells.forEach(c => {
                            if (c) {
                                sumX += c.x;
                                sumY += c.y;
                            }
                        });
                        const centerX = sumX / otherUser.cells.length;
                        const centerY = sumY / otherUser.cells.length;
                        
                        state.lastKnownUserPositions.set(otherUserId, {
                            x: centerX,
                            y: centerY,
                            cells: otherUser.cells.map(c => ({ x: c.x, y: c.y, radius: c.radius })),
                            lastSeen: Date.now()
                        });
                    } else {
                        // No fresh data, but we have cell2 - update with single cell
                        const currentLastKnown = state.lastKnownUserPositions.get(otherUserId);
                        if (!currentLastKnown || 
                            Math.hypot(cell2.x - (currentLastKnown.x || 0), cell2.y - (currentLastKnown.y || 0)) > 10) {
                            state.lastKnownUserPositions.set(otherUserId, {
                                x: cell2.x,
                                y: cell2.y,
                                cells: [{ x: cell2.x, y: cell2.y, radius: cell2.radius }],
                                lastSeen: Date.now()
                            });
                        } else {
                            // Update lastSeen timestamp
                            currentLastKnown.lastSeen = Date.now();
                        }
                    }
                }
            }
        } else {
            // For global view, use specific cell indices
            cell1 = getCellPosition(pair.userId1, pair.cellIndex1);
            cell2 = getCellPosition(pair.userId2, pair.cellIndex2);
        }

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

        // For personal view, always draw lines even if target is off-screen
        // Extend line to screen edges if target is off-screen so direction is always visible
        if (state.mode === 'personal') {
            // Calculate direction from player to target
            const dx = x2 - x1;
            const dy = y2 - y1;
            const distance = Math.hypot(dx, dy);
            
            if (distance > 0) {
                const angle = Math.atan2(dy, dx);
                const screenMargin = 50;
                
                // Check if target is off-screen
                const isOffScreen = x2 < -screenMargin || x2 > canvas.width + screenMargin || 
                                   y2 < -screenMargin || y2 > canvas.height + screenMargin;
                
                if (isOffScreen) {
                    // Extend line to screen edge in the direction of the target
                    // Simple line-rectangle intersection
                    const tValues = [];
                    const invDx = 1 / dx;
                    const invDy = 1 / dy;
                    
                    // Left edge
                    const tLeft = (-screenMargin - x1) * invDx;
                    const yAtLeft = y1 + tLeft * dy;
                    if (tLeft > 0 && yAtLeft >= -screenMargin && yAtLeft <= canvas.height + screenMargin) {
                        tValues.push(tLeft);
                    }
                    
                    // Right edge
                    const tRight = (canvas.width + screenMargin - x1) * invDx;
                    const yAtRight = y1 + tRight * dy;
                    if (tRight > 0 && yAtRight >= -screenMargin && yAtRight <= canvas.height + screenMargin) {
                        tValues.push(tRight);
                    }
                    
                    // Top edge
                    const tTop = (-screenMargin - y1) * invDy;
                    const xAtTop = x1 + tTop * dx;
                    if (tTop > 0 && xAtTop >= -screenMargin && xAtTop <= canvas.width + screenMargin) {
                        tValues.push(tTop);
                    }
                    
                    // Bottom edge
                    const tBottom = (canvas.height + screenMargin - y1) * invDy;
                    const xAtBottom = x1 + tBottom * dx;
                    if (tBottom > 0 && xAtBottom >= -screenMargin && xAtBottom <= canvas.width + screenMargin) {
                        tValues.push(tBottom);
                    }
                    
                    // Use the smallest positive t (closest intersection)
                    if (tValues.length > 0) {
                        const t = Math.min(...tValues.filter(t => t > 0));
                        x2 = x1 + t * dx;
                        y2 = y1 + t * dy;
                    } else {
                        // Fallback: extend in direction to screen edge
                        const maxDist = Math.max(canvas.width, canvas.height) * 2;
                        x2 = x1 + Math.cos(angle) * maxDist;
                        y2 = y1 + Math.sin(angle) * maxDist;
                        
                        // Clamp to reasonable screen bounds
                        x2 = Math.max(-screenMargin * 2, Math.min(canvas.width + screenMargin * 2, x2));
                        y2 = Math.max(-screenMargin * 2, Math.min(canvas.height + screenMargin * 2, y2));
                    }
                }
            }
        }

        // Draw line with better visibility
        ctx.strokeStyle = state.mode === 'personal' 
            ? 'rgba(255, 255, 255, 0.7)'  // Brighter for personal view
            : 'rgba(255, 255, 255, 0.6)'; // Slightly transparent for global
        ctx.lineWidth = state.mode === 'personal' ? 2.5 : 2;
        ctx.lineCap = 'round';
        ctx.setLineDash([]);
        
        // Draw main line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        // Draw glow effect for personal view
        if (state.mode === 'personal') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }
        
        // Draw target indicator (small circle at end of line) for personal view
        // Only draw if target is on screen (no arrow for off-screen targets)
        if (state.mode === 'personal' && !isPlayerCell2) {
            // Only draw if target is another player's cell
            const targetCell = isPlayerCell1 ? cell2 : cell1;
            const targetX = isPlayerCell1 ? x2 : x1;
            const targetY = isPlayerCell1 ? y2 : y1;
            
            // Draw small pulsing circle at target location (only if on screen)
            if (targetX >= 0 && targetX <= canvas.width && 
                targetY >= 0 && targetY <= canvas.height) {
                const targetRadius = Math.max(targetCell.radius * 0.3, 3);
                
                // Outer glow
                ctx.globalCompositeOperation = 'lighter';
                const gradient = ctx.createRadialGradient(
                    targetX, targetY, 0,
                    targetX, targetY, targetRadius * 2
                );
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(150, 200, 255, 0.0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(targetX, targetY, targetRadius * 2, 0, Math.PI * 2);
                ctx.fill();
                
                // Inner circle
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.beginPath();
                ctx.arc(targetX, targetY, targetRadius, 0, Math.PI * 2);
                ctx.fill();
                
                // Border
                ctx.strokeStyle = 'rgba(150, 200, 255, 0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(targetX, targetY, targetRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            // No arrow for off-screen targets - just the line extending to screen edge
        }
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

        drawCellTrail(radius, index, centerX, centerY, screenX, screenY);
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
                        // Update last known position for persistent lines in personal view
                        if (state.mode === 'personal' && user.cells && user.cells.length > 0) {
                            let sumX = 0, sumY = 0;
                            user.cells.forEach(c => {
                                if (c) {
                                    sumX += c.x;
                                    sumY += c.y;
                                }
                            });
                            const centerX = sumX / user.cells.length;
                            const centerY = sumY / user.cells.length;
                            state.lastKnownUserPositions.set(user.id, {
                                x: centerX,
                                y: centerY,
                                cells: user.cells.map(c => ({ x: c.x, y: c.y, radius: c.radius }))
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

    const now = Date.now();

    playerCells.forEach((cell, index) => {
        let trail = state.cellTrails[index];
        if (!trail) {
            trail = [];
            state.cellTrails[index] = trail;
        }
        
        const last = trail[trail.length - 1];
        const moved = !last || Math.hypot(cell.x - last.x, cell.y - last.y) > 0.5;
        
        if (moved) {
            // Calculate velocity from previous position
            let velocity = 0;
            let direction = 0;
            if (last) {
                const dx = cell.x - last.x;
                const dy = cell.y - last.y;
                velocity = Math.hypot(dx, dy);
                direction = Math.atan2(dy, dx);
            }
            
            trail.push({ 
                x: cell.x, 
                y: cell.y, 
                timestamp: now,
                velocity: velocity,
                direction: direction
            });
            
            // Keep more trail points for smoother motion blur
            if (trail.length > 40) {
                trail.shift();
            }
        } else {
            // If not moved, still update timestamp but keep position
            if (last) {
                last.timestamp = now;
            }
            // Remove old stationary trails
            if (trail.length > 4) {
            trail.shift();
            }
        }
    });
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function drawCellTrail(radius, trailIndex, centerX, centerY, currentScreenX, currentScreenY) {
    const trail = state.cellTrails[trailIndex];
    if (!trail || trail.length < 2) return;

    const now = Date.now();
    const MAX_TRAIL_AGE = 800; // 0.8 second max age for trail points

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Calculate screen positions for all trail points
    const screenPoints = trail.map((point, i) => {
        const age = now - (point.timestamp || now);
        const ageRatio = Math.min(age / MAX_TRAIL_AGE, 1);
        const screenX = centerX + (point.x - state.player.x);
        const screenY = centerY + (point.y - state.player.y);
        return {
            x: screenX,
            y: screenY,
            age: age,
            ageRatio: ageRatio,
            velocity: point.velocity || 0,
            direction: point.direction || 0
        };
    });
    
    // Calculate movement direction from trail for arrow placement
    let movementDirection = null;
    let movementSpeed = 0;
    if (screenPoints.length >= 2) {
        const recent = screenPoints[screenPoints.length - 1];
        const older = screenPoints[Math.max(0, screenPoints.length - 3)];
        const dx = recent.x - older.x;
        const dy = recent.y - older.y;
        movementSpeed = Math.hypot(dx, dy);
        if (movementSpeed > 0.5) {
            movementDirection = Math.atan2(dy, dx);
        }
    }
    
    // Draw motion blur trail with gradient
    if (screenPoints.length >= 2) {
        // Extend trail to current position for smoother connection
        const extendedPoints = [...screenPoints];
        if (movementDirection !== null && movementSpeed > 0.5) {
            // Add interpolated point near current position
            const lastPoint = screenPoints[screenPoints.length - 1];
            const lerpAmount = 0.3;
            extendedPoints.push({
                x: lerp(lastPoint.x, currentScreenX, lerpAmount),
                y: lerp(lastPoint.y, currentScreenY, lerpAmount),
                age: 0,
                ageRatio: 0,
                velocity: movementSpeed,
                direction: movementDirection
            });
        }
        
        // Draw smooth curved trail
        ctx.beginPath();
        ctx.moveTo(extendedPoints[0].x, extendedPoints[0].y);
        
        // Use quadratic curves for smoother motion
        for (let i = 1; i < extendedPoints.length; i++) {
            const prev = extendedPoints[i - 1];
            const curr = extendedPoints[i];
            const next = extendedPoints[i + 1];
            
            if (next) {
                // Use control point for smooth curve
                const cpX = lerp(prev.x, curr.x, 0.6);
                const cpY = lerp(prev.y, curr.y, 0.6);
                ctx.quadraticCurveTo(cpX, cpY, curr.x, curr.y);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }
        }
        
        // Create gradient for motion blur effect (from old to recent)
        const startPoint = extendedPoints[0];
        const endPoint = extendedPoints[extendedPoints.length - 1];
        const gradient = ctx.createLinearGradient(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y
        );
        
        // Gradient from faded (old) to bright (recent)
        gradient.addColorStop(0, 'rgba(80, 140, 255, 0.0)'); // Faded at start
        gradient.addColorStop(0.2, 'rgba(100, 160, 255, 0.15)');
        gradient.addColorStop(0.5, 'rgba(120, 180, 255, 0.4)');
        gradient.addColorStop(0.8, 'rgba(150, 200, 255, 0.7)'); // Bright blue at end
        gradient.addColorStop(1, 'rgba(170, 210, 255, 0.85)'); // Brightest at very end
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = radius * 0.5;
        ctx.stroke();
        
        // Draw additional glow layer for motion blur
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.moveTo(extendedPoints[0].x, extendedPoints[0].y);
        for (let i = 1; i < extendedPoints.length; i++) {
            const prev = extendedPoints[i - 1];
            const curr = extendedPoints[i];
            const next = extendedPoints[i + 1];
            
            if (next) {
                const cpX = lerp(prev.x, curr.x, 0.6);
                const cpY = lerp(prev.y, curr.y, 0.6);
                ctx.quadraticCurveTo(cpX, cpY, curr.x, curr.y);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }
        }
        
        const glowGradient = ctx.createLinearGradient(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y
        );
        glowGradient.addColorStop(0, 'rgba(100, 140, 255, 0.0)');
        glowGradient.addColorStop(0.3, 'rgba(120, 160, 255, 0.1)');
        glowGradient.addColorStop(0.6, 'rgba(150, 180, 255, 0.2)');
        glowGradient.addColorStop(1, 'rgba(200, 220, 255, 0.35)');
        
        ctx.strokeStyle = glowGradient;
        ctx.lineWidth = radius * 0.9;
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    }
    
    // Draw direction indicator arrow behind the ball (only when moving)
    if (movementDirection !== null && movementSpeed > 1) {
        // Calculate arrow position (behind the ball, opposite to movement direction)
        // Arrow should point in the movement direction, so place it behind (opposite side)
        const arrowDistance = radius * 1.3;
        const arrowX = currentScreenX - Math.cos(movementDirection) * arrowDistance;
        const arrowY = currentScreenY - Math.sin(movementDirection) * arrowDistance;
        
        // Arrow size based on movement speed
        const arrowLength = Math.min(radius * 0.9, Math.max(radius * 0.5, movementSpeed * 0.25));
        const arrowWidth = Math.max(radius * 0.18, Math.min(radius * 0.25, movementSpeed * 0.05));
        
        // Draw direction arrow (pointing in movement direction)
        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(movementDirection); // Point in movement direction
        
        // Arrow body with gradient (from tail to head)
        const arrowBodyGradient = ctx.createLinearGradient(-arrowLength * 0.7, 0, 0, 0);
        arrowBodyGradient.addColorStop(0, 'rgba(150, 200, 255, 0.6)');
        arrowBodyGradient.addColorStop(1, 'rgba(200, 230, 255, 0.95)');
        
        ctx.beginPath();
        ctx.moveTo(-arrowLength * 0.7, 0);
        ctx.lineTo(0, 0);
        ctx.strokeStyle = arrowBodyGradient;
        ctx.lineWidth = arrowWidth * 1.3;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Arrow head with glow effect
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength * 0.4, -arrowWidth * 2.0);
        ctx.lineTo(-arrowLength * 0.4, arrowWidth * 2.0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(220, 240, 255, 0.85)';
        ctx.fill();
        
        // Inner arrow head for better definition
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength * 0.35, -arrowWidth * 1.4);
        ctx.lineTo(-arrowLength * 0.35, arrowWidth * 1.4);
        ctx.closePath();
        ctx.fillStyle = 'rgba(180, 220, 255, 0.95)';
        ctx.fill();
        
        ctx.restore();
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
