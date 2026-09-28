// Hostinger / LiteSpeed starter: lsnode loads the entry file with require(), which cannot load an ES module graph that
// uses top-level await (the game server does). A dynamic import() from this CommonJS file starts it the modern way.
import('./services/game-service/src/server.js').catch((err) => { console.error(err); process.exit(1); });
