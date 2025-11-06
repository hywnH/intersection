module.exports = {
    host: "0.0.0.0",
    port: 3000,
    logpath: "logger.php",
    limitSplit: 16,
    defaultPlayerMass: 10,
    gameWidth: 5000,
    gameHeight: 5000,
    adminPass: "DEFAULT",
    slowBase: 4.5,
    logChat: 0,
    networkUpdateFactor: 40,
    maxHeartbeatInterval: 5000,
    newPlayerInitialPosition: "farthest",
    massLossRate: 1,
    minMassLoss: 50,
    allowedOrigins: ['*'],
    sqlinfo: {
      fileName: "db.sqlite3",
    }
};
