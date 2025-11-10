"use strict";

const {isVisibleEntity} = require("../lib/entityUtils");

exports.playerUtils = require('./player');

exports.Map = class {
    constructor(config) {
        this.players = new exports.playerUtils.PlayerManager();
    }

    enumerateWhatPlayersSee(callback) {
        for (let currentPlayer of this.players.data) {
            const extractData = (player) => {
                return {
                    x: player.x,
                    y: player.y,
                    cells: player.cells,
                    massTotal: Math.round(player.massTotal),
                    hue: player.hue,
                    id: player.id,
                    name: player.name
                };
            }

            var visiblePlayers = [];
            var visiblePlayerIds = new Set();
            
            // First, add visible players (normal behavior)
            for (let player of this.players.data) {
                for (let cell of player.cells) {
                    if (isVisibleEntity(cell, currentPlayer)) {
                        visiblePlayers.push(extractData(player));
                        visiblePlayerIds.add(player.id);
                        break;
                    }
                }
            }
            
            // Then, add tracked players (for collision pairs) even if they're off-screen
            // This ensures clients always receive position updates for collision pairs
            if (currentPlayer.trackedUserIds && currentPlayer.trackedUserIds.size > 0) {
                for (let player of this.players.data) {
                    // Skip if already added as visible, or if it's the current player
                    if (visiblePlayerIds.has(player.id) || player.id === currentPlayer.id) {
                        continue;
                    }
                    
                    // Add if this player is in the tracked list
                    if (currentPlayer.trackedUserIds.has(player.id)) {
                        visiblePlayers.push(extractData(player));
                        visiblePlayerIds.add(player.id);
                    }
                }
            }

            callback(extractData(currentPlayer), visiblePlayers);
        }
    }
}
