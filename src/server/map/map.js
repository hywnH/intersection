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
            for (let player of this.players.data) {
                for (let cell of player.cells) {
                    if (isVisibleEntity(cell, currentPlayer)) {
                        visiblePlayers.push(extractData(player));
                        break;
                    }
                }
            }

            callback(extractData(currentPlayer), visiblePlayers);
        }
    }
}
