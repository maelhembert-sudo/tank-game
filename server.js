const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 5000, // Vérification battement de cœur toutes les 5s
  pingTimeout: 7000   // Déconnexion détectée après 7s max si rupture réseau
});

const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques depuis /public
app.use(express.static(path.join(__dirname, 'public')));

// Raccourcis d'URL conviviaux
app.get('/tank', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tank.html'));
});
app.get('/pong', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pong.html'));
});
app.get('/blob', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blob.html'));
});
app.get('/brick', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'brick.html'));
});

// Dimensions de l'arène de jeu
const MAP_WIDTH = 1800;
const MAP_HEIGHT = 1200;

// Murs fixes de la carte (arène tactique avec zones de couverture)
const WALLS = [
  // Bords extérieurs de la carte
  { x: 0, y: 0, width: MAP_WIDTH, height: 20 },
  { x: 0, y: MAP_HEIGHT - 20, width: MAP_WIDTH, height: 20 },
  { x: 0, y: 0, width: 20, height: MAP_HEIGHT },
  { x: MAP_WIDTH - 20, y: 0, width: 20, height: MAP_HEIGHT },

  // Bloc central
  { x: MAP_WIDTH / 2 - 100, y: MAP_HEIGHT / 2 - 100, width: 200, height: 40 },
  { x: MAP_WIDTH / 2 - 100, y: MAP_HEIGHT / 2 + 60, width: 200, height: 40 },
  { x: MAP_WIDTH / 2 - 20, y: MAP_HEIGHT / 2 - 60, width: 40, height: 120 },

  // Abris quadrants haut-gauche & haut-droite
  { x: 300, y: 250, width: 200, height: 35 },
  { x: 465, y: 250, width: 35, height: 200 },
  { x: MAP_WIDTH - 500, y: 250, width: 200, height: 35 },
  { x: MAP_WIDTH - 500, y: 250, width: 35, height: 200 },

  // Abris quadrants bas-gauche & bas-droite
  { x: 300, y: MAP_HEIGHT - 285, width: 200, height: 35 },
  { x: 465, y: MAP_HEIGHT - 450, width: 35, height: 200 },
  { x: MAP_WIDTH - 500, y: MAP_HEIGHT - 285, width: 200, height: 35 },
  { x: MAP_WIDTH - 500, y: MAP_HEIGHT - 450, width: 35, height: 200 },

  // Piliers stratégiques
  { x: 800, y: 200, width: 50, height: 120 },
  { x: 950, y: 200, width: 50, height: 120 },
  { x: 800, y: MAP_HEIGHT - 320, width: 50, height: 120 },
  { x: 950, y: MAP_HEIGHT - 320, width: 50, height: 120 },
  { x: 200, y: MAP_HEIGHT / 2 - 50, width: 50, height: 100 },
  { x: MAP_WIDTH - 250, y: MAP_HEIGHT / 2 - 50, width: 50, height: 100 }
];

// Spawns prédéfinis
const SPAWN_POINTS = [
  { x: 120, y: 120 },
  { x: MAP_WIDTH - 120, y: 120 },
  { x: 120, y: MAP_HEIGHT - 120 },
  { x: MAP_WIDTH - 120, y: MAP_HEIGHT - 120 },
  { x: MAP_WIDTH / 2, y: 120 },
  { x: MAP_WIDTH / 2, y: MAP_HEIGHT - 120 },
  { x: 120, y: MAP_HEIGHT / 2 },
  { x: MAP_WIDTH - 120, y: MAP_HEIGHT / 2 }
];

// État global de la partie
const gameState = {
  players: {},
  bullets: [],
  explosions: [],
  powerups: [],
  nextBulletId: 1
};

// Powerups types
const POWERUP_TYPES = [
  { type: 'speed', color: '#38ef7d', label: 'VITESSE' },
  { type: 'rapid', color: '#ffb300', label: 'TIR RAPIDE' },
  { type: 'shield', color: '#00d2ff', label: 'BOUCLIER' },
  { type: 'triple', color: '#ff007f', label: 'TRIPLE TIR' }
];

function spawnPowerup() {
  const regularPowerups = gameState.powerups.filter(p => p.type !== 'health');
  if (regularPowerups.length >= 3) return;
  const pType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  let safe = false;
  let px = 0, py = 0;
  for (let tries = 0; tries < 20; tries++) {
    px = 80 + Math.random() * (MAP_WIDTH - 160);
    py = 80 + Math.random() * (MAP_HEIGHT - 160);
    const collides = WALLS.some(w => checkRectCircle(w, px, py, 30));
    if (!collides) {
      safe = true;
      break;
    }
  }
  if (safe) {
    gameState.powerups.push({
      id: Date.now() + Math.random(),
      x: px,
      y: py,
      type: pType.type,
      color: pType.color,
      label: pType.label,
      radius: 18,
      createdAt: Date.now()
    });
  }
}

// Spawner un kit de soin rare (pas tout le temps, max 1 sur la carte)
function spawnRareHealthKit() {
  const hasHealthPack = gameState.powerups.some(p => p.type === 'health');
  if (hasHealthPack) return;

  const activePlayers = Object.values(gameState.players).filter(p => p.isAlive);
  if (activePlayers.length === 0) return;

  let safe = false;
  let px = 0, py = 0;
  for (let tries = 0; tries < 25; tries++) {
    px = 120 + Math.random() * (MAP_WIDTH - 240);
    py = 120 + Math.random() * (MAP_HEIGHT - 240);
    const collides = WALLS.some(w => checkRectCircle(w, px, py, 35));
    if (!collides) {
      safe = true;
      break;
    }
  }

  if (safe) {
    gameState.powerups.push({
      id: Date.now() + Math.random(),
      x: px,
      y: py,
      type: 'health',
      color: '#10b981',
      label: 'SOIN +50',
      radius: 20,
      createdAt: Date.now()
    });

    io.emit('chat_message', {
      sender: 'Ravitaillement',
      text: '🏥 Un kit de réparation rare a été largué dans l\'arène !',
      color: '#10b981'
    });
    io.emit('sound_event', { type: 'health_spawn', x: px, y: py });
  }
}

// Spawner un powerup classique toutes les 14 secondes
setInterval(spawnPowerup, 14000);

// Spawner le kit de soin rare toutes les 35 secondes (1 max dans l'arène)
setInterval(spawnRareHealthKit, 35000);

// Helper : collision Cercle vs Rectangle
function checkRectCircle(rect, cx, cy, radius) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (radius * radius);
}

// Trouver un point de spawn sûr
function getSafeSpawn() {
  const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);
  for (const pt of shuffled) {
    const isOccupied = Object.values(gameState.players).some(p => {
      if (!p.isAlive) return false;
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      return d < 100;
    });
    if (!isOccupied) return { x: pt.x, y: pt.y };
  }
  return { ...shuffled[0] };
}

// Palette de couleurs pour les tanks
const TANK_COLORS = ['#e52d27', '#00b4d8', '#2ec4b6', '#ff9f1c', '#9d4edd', '#ff006e', '#80ed99'];

// Configuration des Bots IA pour jeu solo
const BOTS_CONFIG = [
  { id: 'bot_1', name: '🤖 Terminator', color: '#ff9f1c' },
  { id: 'bot_2', name: '🤖 Hunter', color: '#9d4edd' }
];

function manageBots() {
  const humanPlayers = Object.values(gameState.players).filter(p => !p.isBot);

  // S'il n'y a qu'1 seul joueur humain, on déploie 2 bots pour l'affronter
  if (humanPlayers.length === 1) {
    BOTS_CONFIG.forEach(cfg => {
      if (!gameState.players[cfg.id]) {
        const spawn = getSafeSpawn();
        gameState.players[cfg.id] = {
          id: cfg.id,
          isBot: true,
          name: cfg.name,
          color: cfg.color,
          x: spawn.x,
          y: spawn.y,
          bodyAngle: Math.random() * Math.PI * 2,
          turretAngle: 0,
          radius: 24,
          width: 44,
          height: 36,
          health: 150,
          maxHealth: 150,
          isAlive: true,
          kills: 0,
          deaths: 0,
          score: 0,
          shield: Date.now() + 2500,
          shieldHits: 0,
          shieldExpiresAt: 0,
          speedMultiplier: 0.85, // Vitesse équilibrée pour un combat dynamique et amusant
          rapidFireUntil: 0,
          tripleShotUntil: 0,
          lastShotTime: 0,
          inputs: { forward: false, backward: false, left: false, right: false, shoot: false, controlMode: 'classic' },
          ai: {
            reverseCooldown: 0,
            preferredDistance: 240 + Math.random() * 80
          }
        };
        io.emit('chat_message', {
          sender: 'Système',
          text: `${cfg.name} entre dans l'arène pour vous défier !`,
          color: '#38bdf8'
        });
      }
    });
  } else if (humanPlayers.length === 0 || humanPlayers.length >= 2) {
    // Si aucun humain (serveur au repos) ou s'il y a plusieurs vrais joueurs, on retire les bots
    BOTS_CONFIG.forEach(cfg => {
      if (gameState.players[cfg.id]) {
        delete gameState.players[cfg.id];
        io.emit('chat_message', {
          sender: 'Système',
          text: `${cfg.name} quitte l'arène pour laisser place aux joueurs !`,
          color: '#94a3b8'
        });
      }
    });
  }
}

function updateBotAI(bot, now) {
  // Trouver la cible la plus proche (priorité absolue aux joueurs humains)
  let nearestTarget = null;
  let minDist = Infinity;

  for (const id in gameState.players) {
    const target = gameState.players[id];
    if (target.id === bot.id || !target.isAlive) continue;
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    const scoreWeight = target.isBot ? 1.6 : 1.0;
    if (d * scoreWeight < minDist) {
      minDist = d * scoreWeight;
      nearestTarget = target;
    }
  }

  if (!nearestTarget) {
    bot.inputs.forward = false;
    bot.inputs.backward = false;
    bot.inputs.left = false;
    bot.inputs.right = false;
    bot.inputs.shoot = false;
    return;
  }

  // La tourelle du bot s'oriente indépendamment vers la cible !
  const angleToTarget = Math.atan2(nearestTarget.y - bot.y, nearestTarget.x - bot.x);
  bot.turretAngle = angleToTarget;

  // Si le bot a peu de PV (< 75) et qu'un kit de soin rare est disponible sur la carte, il tente de le récupérer
  let steerTarget = nearestTarget;
  if (bot.health < 75) {
    const healthPack = gameState.powerups.find(p => p.type === 'health');
    if (healthPack) {
      steerTarget = healthPack;
    }
  }

  const angleToSteer = Math.atan2(steerTarget.y - bot.y, steerTarget.x - bot.x);
  let diff = (angleToSteer - bot.bodyAngle) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;

  // Détection d'obstacles devant le bot (évitement des murs)
  const probeDist = 55;
  const probeX = bot.x + Math.cos(bot.bodyAngle) * probeDist;
  const probeY = bot.y + Math.sin(bot.bodyAngle) * probeDist;
  let wallAhead = false;
  for (let i = 0; i < WALLS.length; i++) {
    if (checkRectCircle(WALLS[i], probeX, probeY, bot.radius)) {
      wallAhead = true;
      break;
    }
  }

  if (wallAhead) {
    bot.ai.reverseCooldown = 22; // Reculer pendant 22 ticks
  }

  if (bot.ai.reverseCooldown > 0) {
    bot.ai.reverseCooldown--;
    bot.inputs.forward = false;
    bot.inputs.backward = true;
    bot.inputs.left = false;
    bot.inputs.right = true; // Tourner pour dégager l'angle
  } else {
    bot.inputs.backward = false;

    // Rotation fluide du châssis vers la direction voulue
    if (Math.abs(diff) > 0.08) {
      bot.inputs.left = diff < 0;
      bot.inputs.right = diff > 0;
    } else {
      bot.inputs.left = false;
      bot.inputs.right = false;
    }

    // Distance d'engagement tactique
    const targetDist = Math.hypot(steerTarget.x - bot.x, steerTarget.y - bot.y);
    if (steerTarget !== nearestTarget) {
      // En route vers le kit de soin !
      bot.inputs.forward = true;
    } else if (targetDist > bot.ai.preferredDistance) {
      bot.inputs.forward = true;
    } else if (targetDist < 140) {
      bot.inputs.backward = true;
    } else {
      bot.inputs.forward = false;
    }
  }

  // Décision de tir : la tourelle vise directement la cible
  const realDist = Math.hypot(nearestTarget.x - bot.x, nearestTarget.y - bot.y);
  if (realDist < 620 && bot.ai.reverseCooldown === 0) {
    bot.inputs.shoot = true;
    attemptShoot(bot);
  } else {
    bot.inputs.shoot = false;
  }
}

// ==========================================
// CONFIGURATION & SALLES DU JEU NEON PONG 1v1
// ==========================================
const PONG_WIDTH = 900;
const PONG_HEIGHT = 550;
const PADDLE_WIDTH = 14;
const PADDLE_HEIGHT = 100;
const PADDLE_SPEED = 7;
const BOT_SPEED = 5.2;

const pongRooms = {
  p1: null, // Socket ID du Joueur 1
  p2: null, // Socket ID du Joueur 2
  spectators: new Set(),
  inputs: {} // socketId -> { up: bool, down: bool }
};

let pongState = {
  width: PONG_WIDTH,
  height: PONG_HEIGHT,
  p1: { y: (PONG_HEIGHT - PADDLE_HEIGHT) / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, score: 0, name: 'Joueur 1' },
  p2: { y: (PONG_HEIGHT - PADDLE_HEIGHT) / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, score: 0, name: '🤖 Bot IA', isBot: true },
  ball: { x: PONG_WIDTH / 2, y: PONG_HEIGHT / 2, radius: 9, vx: 6, vy: 3 },
  isGameOver: false,
  winner: null
};

let pongServeCountdown = 45; // Délais avant remise en jeu (~0.75s)

function resetPongBall(servingToRight = Math.random() > 0.5) {
  pongState.ball.x = PONG_WIDTH / 2;
  pongState.ball.y = PONG_HEIGHT / 2;
  const angle = (Math.random() * 0.6 - 0.3);
  const speed = 6.5;
  pongState.ball.vx = (servingToRight ? 1 : -1) * speed * Math.cos(angle);
  pongState.ball.vy = speed * Math.sin(angle);
  pongServeCountdown = 45;
}

function resetPongMatch() {
  pongState.p1.score = 0;
  pongState.p2.score = 0;
  pongState.isGameOver = false;
  pongState.winner = null;
  pongState.p1.y = (PONG_HEIGHT - PADDLE_HEIGHT) / 2;
  pongState.p2.y = (PONG_HEIGHT - PADDLE_HEIGHT) / 2;
  resetPongBall();
}

function updatePongNamesAndRoles() {
  pongState.p1.name = 'Joueur 1';
  if (pongRooms.p2) {
    pongState.p2.name = 'Joueur 2';
    pongState.p2.isBot = false;
  } else {
    pongState.p2.name = '🤖 Bot IA';
    pongState.p2.isBot = true;
  }
}

function isSocketActive(socketId) {
  if (!socketId) return false;
  const s = io.sockets.sockets.get(socketId);
  return !!(s && s.connected);
}

function handlePongDisconnect(socketId) {
  let changed = false;

  if (pongRooms.inputs[socketId]) {
    delete pongRooms.inputs[socketId];
  }

  if (socketId === pongRooms.p1) {
    changed = true;
    if (pongRooms.p2 && isSocketActive(pongRooms.p2)) {
      // P2 devient P1
      pongRooms.p1 = pongRooms.p2;
      pongRooms.p2 = null;
      io.to(pongRooms.p1).emit('pong_role', { role: 'p1' });

      // Si un spectateur actif attend, il devient P2
      for (const nextUser of Array.from(pongRooms.spectators)) {
        pongRooms.spectators.delete(nextUser);
        if (isSocketActive(nextUser)) {
          pongRooms.p2 = nextUser;
          io.to(nextUser).emit('pong_role', { role: 'p2' });
          break;
        }
      }
    } else {
      pongRooms.p1 = null;
      pongRooms.p2 = null;
      resetPongMatch();
    }
  } else if (socketId === pongRooms.p2) {
    changed = true;
    pongRooms.p2 = null;

    // Si un spectateur actif attend, il devient P2
    for (const nextUser of Array.from(pongRooms.spectators)) {
      pongRooms.spectators.delete(nextUser);
      if (isSocketActive(nextUser)) {
        pongRooms.p2 = nextUser;
        io.to(nextUser).emit('pong_role', { role: 'p2' });
        break;
      }
    }
  } else if (pongRooms.spectators.has(socketId)) {
    pongRooms.spectators.delete(socketId);
    changed = true;
  }

  updatePongNamesAndRoles();
  if (changed) {
    broadcastHubStats();
  }
}

function cleanPongRooms() {
  let changed = false;

  if (pongRooms.p1 && !isSocketActive(pongRooms.p1)) {
    handlePongDisconnect(pongRooms.p1);
    changed = true;
  }
  if (pongRooms.p2 && !isSocketActive(pongRooms.p2)) {
    handlePongDisconnect(pongRooms.p2);
    changed = true;
  }

  for (const specId of Array.from(pongRooms.spectators)) {
    if (!isSocketActive(specId)) {
      pongRooms.spectators.delete(specId);
      changed = true;
    }
  }

  if (changed) {
    updatePongNamesAndRoles();
  }
  return changed;
}

function updatePongPhysics() {
  if (!pongRooms.p1) return;

  // 1. Mouvement des Raquettes
  if (pongRooms.p1 && pongRooms.inputs[pongRooms.p1]) {
    const inp = pongRooms.inputs[pongRooms.p1];
    if (inp.up) pongState.p1.y = Math.max(0, pongState.p1.y - PADDLE_SPEED);
    if (inp.down) pongState.p1.y = Math.min(PONG_HEIGHT - PADDLE_HEIGHT, pongState.p1.y + PADDLE_SPEED);
  }

  if (pongRooms.p2) {
    if (pongRooms.inputs[pongRooms.p2]) {
      const inp = pongRooms.inputs[pongRooms.p2];
      if (inp.up) pongState.p2.y = Math.max(0, pongState.p2.y - PADDLE_SPEED);
      if (inp.down) pongState.p2.y = Math.min(PONG_HEIGHT - PADDLE_HEIGHT, pongState.p2.y + PADDLE_SPEED);
    }
  } else {
    // Bot IA
    const paddleCenter = pongState.p2.y + PADDLE_HEIGHT / 2;
    let targetY = PONG_HEIGHT / 2;
    if (pongState.ball.vx > 0) {
      targetY = pongState.ball.y;
    }
    const diff = targetY - paddleCenter;
    if (Math.abs(diff) > 6) {
      if (diff > 0) {
        pongState.p2.y = Math.min(PONG_HEIGHT - PADDLE_HEIGHT, pongState.p2.y + BOT_SPEED);
      } else {
        pongState.p2.y = Math.max(0, pongState.p2.y - BOT_SPEED);
      }
    } else if (pongState.ball.vx <= 0) {
      const centerDiff = (PONG_HEIGHT / 2) - paddleCenter;
      if (Math.abs(centerDiff) > 10) {
        pongState.p2.y += Math.sign(centerDiff) * 2.2;
      }
    }
  }

  // 2. Pause de service
  if (pongServeCountdown > 0) {
    pongServeCountdown--;
    return;
  }

  if (pongState.isGameOver) return;

  // 3. Déplacement de la balle
  pongState.ball.x += pongState.ball.vx;
  pongState.ball.y += pongState.ball.vy;

  // Rebond haut / bas
  if (pongState.ball.y - pongState.ball.radius <= 0) {
    pongState.ball.y = pongState.ball.radius;
    pongState.ball.vy = -pongState.ball.vy;
    io.to('pong_room').emit('pong_sound', 'wall');
  } else if (pongState.ball.y + pongState.ball.radius >= PONG_HEIGHT) {
    pongState.ball.y = PONG_HEIGHT - pongState.ball.radius;
    pongState.ball.vy = -pongState.ball.vy;
    io.to('pong_room').emit('pong_sound', 'wall');
  }

  // Rebond Raquette P1 (Gauche, X: 30 -> 44)
  const p1X = 30;
  const p1Right = p1X + PADDLE_WIDTH;
  if (pongState.ball.vx < 0 &&
      pongState.ball.x - pongState.ball.radius <= p1Right &&
      pongState.ball.x + pongState.ball.radius >= p1X) {
    if (pongState.ball.y + pongState.ball.radius >= pongState.p1.y &&
        pongState.ball.y - pongState.ball.radius <= pongState.p1.y + PADDLE_HEIGHT) {
      const hitOffset = (pongState.ball.y - (pongState.p1.y + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      const clampedOffset = Math.max(-1, Math.min(1, hitOffset));
      const angle = clampedOffset * (Math.PI / 3);
      const speed = Math.min(14, Math.hypot(pongState.ball.vx, pongState.ball.vy) + 0.35);
      pongState.ball.vx = speed * Math.cos(angle);
      pongState.ball.vy = speed * Math.sin(angle);
      pongState.ball.x = p1Right + pongState.ball.radius;
      io.to('pong_room').emit('pong_sound', 'hit');
    }
  }

  // Rebond Raquette P2 (Droite, X: 856 -> 870)
  const p2X = PONG_WIDTH - 30 - PADDLE_WIDTH;
  const p2Right = p2X + PADDLE_WIDTH;
  if (pongState.ball.vx > 0 &&
      pongState.ball.x + pongState.ball.radius >= p2X &&
      pongState.ball.x - pongState.ball.radius <= p2Right) {
    if (pongState.ball.y + pongState.ball.radius >= pongState.p2.y &&
        pongState.ball.y - pongState.ball.radius <= pongState.p2.y + PADDLE_HEIGHT) {
      const hitOffset = (pongState.ball.y - (pongState.p2.y + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      const clampedOffset = Math.max(-1, Math.min(1, hitOffset));
      const angle = clampedOffset * (Math.PI / 3);
      const speed = Math.min(14, Math.hypot(pongState.ball.vx, pongState.ball.vy) + 0.35);
      pongState.ball.vx = -speed * Math.cos(angle);
      pongState.ball.vy = speed * Math.sin(angle);
      pongState.ball.x = p2X - pongState.ball.radius;
      io.to('pong_room').emit('pong_sound', 'hit');
    }
  }

  // Point marqué
  if (pongState.ball.x < 0) {
    pongState.p2.score++;
    io.to('pong_room').emit('pong_sound', 'score');
    if (pongState.p2.score >= 7) {
      pongState.isGameOver = true;
      pongState.winner = pongState.p2.isBot ? '🤖 Bot IA' : pongState.p2.name;
    } else {
      resetPongBall(true);
    }
  } else if (pongState.ball.x > PONG_WIDTH) {
    pongState.p1.score++;
    io.to('pong_room').emit('pong_sound', 'score');
    if (pongState.p1.score >= 7) {
      pongState.isGameOver = true;
      pongState.winner = pongState.p1.name;
    } else {
      resetPongBall(false);
    }
  }
}

function cleanTankPlayers() {
  let changed = false;
  for (const id in gameState.players) {
    const p = gameState.players[id];
    if (p.isBot) continue;
    if (!isSocketActive(id)) {
      delete gameState.players[id];
      changed = true;
    }
  }
  if (changed) {
    manageBots();
  }
  return changed;
}

function getActiveTankPlayersCount() {
  cleanTankPlayers();
  return Object.values(gameState.players).filter(p => !p.isBot).length;
}

function getActivePongPlayersCount() {
  cleanPongRooms();
  let count = 0;
  if (pongRooms.p1 && isSocketActive(pongRooms.p1)) count++;
  if (pongRooms.p2 && isSocketActive(pongRooms.p2)) count++;
  return count;
}

// ==========================================
// CONFIGURATION & SIMULATION BLOB CLASH (AGAR.IO)
// ==========================================
const BLOB_MAP_WIDTH = 3000;
const BLOB_MAP_HEIGHT = 3000;
const MAX_FOOD_PELLETS = 360;
const VIRUS_COUNT = 14;
const FOOD_COLORS = [
  '#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6',
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f97316'
];

const BOT_BLOB_NAMES = [
  '🤖 Spore', '🤖 Amoeba', '🤖 Glouton', '🤖 Vortex',
  '🤖 Titania', '🤖 Microbe', '🤖 Nebula', '🤖 Titan'
];

const blobState = {
  players: {}, // id -> player
  food: new Map(), // id -> { id, x, y, color, radius }
  ejected: [], // [{ id, x, y, vx, vy, radius, mass, color }]
  viruses: [], // [{ id, x, y, radius }]
  nextId: 1
};

const blobFoodDelta = {
  eaten: [],
  added: []
};

// Générer les pastilles de nourriture initiales
function spawnFoodPellet() {
  const fid = blobState.nextId++;
  const food = {
    id: fid,
    x: Math.round(30 + Math.random() * (BLOB_MAP_WIDTH - 60)),
    y: Math.round(30 + Math.random() * (BLOB_MAP_HEIGHT - 60)),
    color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
    radius: 5
  };
  blobState.food.set(fid, food);
  return food;
}

for (let i = 0; i < MAX_FOOD_PELLETS; i++) {
  spawnFoodPellet();
}

// Générer les virus (obstacles piquants)
for (let i = 0; i < VIRUS_COUNT; i++) {
  blobState.viruses.push({
    id: i + 1,
    x: Math.round(150 + Math.random() * (BLOB_MAP_WIDTH - 300)),
    y: Math.round(150 + Math.random() * (BLOB_MAP_HEIGHT - 300)),
    radius: 38
  });
}

// Gestion des bots IA pour Blob Clash
function manageBlobBots() {
  BOT_BLOB_NAMES.forEach((botName, idx) => {
    const botId = `bot_blob_${idx}`;
    if (!blobState.players[botId] || !blobState.players[botId].isAlive) {
      const spawnX = 200 + Math.random() * (BLOB_MAP_WIDTH - 400);
      const spawnY = 200 + Math.random() * (BLOB_MAP_HEIGHT - 400);
      const botColor = FOOD_COLORS[idx % FOOD_COLORS.length];

      blobState.players[botId] = {
        id: botId,
        name: botName,
        color: botColor,
        isBot: true,
        isAlive: true,
        killedBy: null,
        target: { x: spawnX, y: spawnY },
        cells: [{
          id: 1,
          x: spawnX,
          y: spawnY,
          radius: 22,
          mass: 20,
          vx: 0,
          vy: 0,
          canMergeAt: 0
        }],
        botTimer: 0
      };
    }
  });
}

// Nettoyer les joueurs humains déconnectés de Blob Clash
function cleanBlobPlayers() {
  let changed = false;
  for (const id in blobState.players) {
    const p = blobState.players[id];
    if (p.isBot) continue;
    if (!isSocketActive(id)) {
      delete blobState.players[id];
      changed = true;
    }
  }
  return changed;
}

function getActiveBlobPlayersCount() {
  cleanBlobPlayers();
  return Object.values(blobState.players).filter(p => !p.isBot).length;
}

function getSafeBlobSpawn() {
  return {
    x: 200 + Math.random() * (BLOB_MAP_WIDTH - 400),
    y: 200 + Math.random() * (BLOB_MAP_HEIGHT - 400)
  };
}

// IA dynamique pour les bots
function updateBlobBotAI(bot) {
  if (!bot.isAlive || !bot.cells || bot.cells.length === 0) return;
  const mainCell = bot.cells[0];

  // 1. Détecter un prédateur proche (cellule plus grosse de 15% dans un rayon de 260px)
  let threat = null;
  let threatDist = 260;
  for (const pid in blobState.players) {
    const other = blobState.players[pid];
    if (!other.isAlive || other.id === bot.id || !other.cells) continue;
    for (const oc of other.cells) {
      if (oc.mass > mainCell.mass * 1.15) {
        const d = Math.hypot(oc.x - mainCell.x, oc.y - mainCell.y);
        if (d < threatDist) {
          threatDist = d;
          threat = oc;
        }
      }
    }
  }

  if (threat) {
    const dx = mainCell.x - threat.x;
    const dy = mainCell.y - threat.y;
    bot.target.x = mainCell.x + dx * 2;
    bot.target.y = mainCell.y + dy * 2;
    return;
  }

  // 2. Détecter une proie chassable (cellule plus petite de 20% dans un rayon de 220px)
  let prey = null;
  let preyDist = 220;
  for (const pid in blobState.players) {
    const other = blobState.players[pid];
    if (!other.isAlive || other.id === bot.id || !other.cells) continue;
    for (const oc of other.cells) {
      if (mainCell.mass > oc.mass * 1.2) {
        const d = Math.hypot(oc.x - mainCell.x, oc.y - mainCell.y);
        if (d < preyDist) {
          preyDist = d;
          prey = oc;
        }
      }
    }
  }

  if (prey) {
    bot.target.x = prey.x;
    bot.target.y = prey.y;
    return;
  }

  // 3. Chercher la nourriture la plus proche
  if (++bot.botTimer > 15) {
    bot.botTimer = 0;
    let closestFood = null;
    let minDist = 320;
    for (const f of blobState.food.values()) {
      const d = Math.hypot(f.x - mainCell.x, f.y - mainCell.y);
      if (d < minDist) {
        minDist = d;
        closestFood = f;
      }
    }
    if (closestFood) {
      bot.target.x = closestFood.x;
      bot.target.y = closestFood.y;
    } else {
      bot.target.x = Math.max(100, Math.min(BLOB_MAP_WIDTH - 100, mainCell.x + (Math.random() - 0.5) * 400));
      bot.target.y = Math.max(100, Math.min(BLOB_MAP_HEIGHT - 100, mainCell.y + (Math.random() - 0.5) * 400));
    }
  }
}

// Simulation physique de Blob Clash (45 Hz)
function updateBlobPhysics() {
  const now = Date.now();
  cleanBlobPlayers();
  manageBlobBots();

  // 1. Déplacement des cellules des joueurs et bots
  for (const pid in blobState.players) {
    const p = blobState.players[pid];
    if (!p.isAlive || !p.cells || p.cells.length === 0) continue;

    if (p.isBot) {
      updateBlobBotAI(p);
    }

    p.cells.forEach(cell => {
      cell.radius = Math.max(16, Math.sqrt(cell.mass * 26));
      const speed = Math.max(1.8, 6.4 - Math.log(cell.mass + 1) * 0.68);

      const dx = p.target.x - cell.x;
      const dy = p.target.y - cell.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 8) {
        const moveStep = Math.min(speed, dist);
        cell.x += (dx / dist) * moveStep;
        cell.y += (dy / dist) * moveStep;
      }

      cell.x += cell.vx;
      cell.y += cell.vy;
      cell.vx *= 0.88;
      cell.vy *= 0.88;

      cell.x = Math.max(cell.radius, Math.min(BLOB_MAP_WIDTH - cell.radius, cell.x));
      cell.y = Math.max(cell.radius, Math.min(BLOB_MAP_HEIGHT - cell.radius, cell.y));
    });

    // Gestion du Merge (recombinaison) ou répulsion
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const c1 = p.cells[i];
        const c2 = p.cells[j];
        const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
        const minDist = c1.radius + c2.radius;

        if (d < minDist) {
          if (now >= c1.canMergeAt && now >= c2.canMergeAt) {
            c1.mass += c2.mass;
            c1.radius = Math.max(16, Math.sqrt(c1.mass * 26));
            p.cells.splice(j, 1);
            j--;
          } else {
            const overlap = minDist - d;
            const pushAngle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
            c1.x -= Math.cos(pushAngle) * (overlap * 0.5);
            c1.y -= Math.sin(pushAngle) * (overlap * 0.5);
            c2.x += Math.cos(pushAngle) * (overlap * 0.5);
            c2.y += Math.sin(pushAngle) * (overlap * 0.5);
          }
        }
      }
    }
  }

  // 2. Déplacement des pastilles éjectées
  for (let i = blobState.ejected.length - 1; i >= 0; i--) {
    const ep = blobState.ejected[i];
    ep.x += ep.vx;
    ep.y += ep.vy;
    ep.vx *= 0.90;
    ep.vy *= 0.90;
    ep.x = Math.max(ep.radius, Math.min(BLOB_MAP_WIDTH - ep.radius, ep.x));
    ep.y = Math.max(ep.radius, Math.min(BLOB_MAP_HEIGHT - ep.radius, ep.y));
  }

  // 3. Collision : Cellules mangeant de la Nourriture (Food)
  for (const pid in blobState.players) {
    const p = blobState.players[pid];
    if (!p.isAlive) continue;

    p.cells.forEach(cell => {
      for (const [fid, f] of blobState.food) {
        if (Math.abs(cell.x - f.x) < cell.radius && Math.abs(cell.y - f.y) < cell.radius) {
          const d = Math.hypot(cell.x - f.x, cell.y - f.y);
          if (d < cell.radius) {
            cell.mass += 1;
            blobState.food.delete(fid);
            blobFoodDelta.eaten.push(fid);

            const newF = spawnFoodPellet();
            blobFoodDelta.added.push(newF);
          }
        }
      }

      // Pastilles éjectées mangées
      for (let i = blobState.ejected.length - 1; i >= 0; i--) {
        const ep = blobState.ejected[i];
        const d = Math.hypot(cell.x - ep.x, cell.y - ep.y);
        if (d < cell.radius) {
          cell.mass += ep.mass;
          blobState.ejected.splice(i, 1);
        }
      }

      // Collision avec les Virus
      blobState.viruses.forEach(virus => {
        const d = Math.hypot(cell.x - virus.x, cell.y - virus.y);
        if (d < cell.radius + virus.radius && cell.radius > virus.radius * 1.1) {
          if (p.cells.length < 8 && cell.mass >= 40) {
            const splitCount = Math.min(4, Math.floor(cell.mass / 25));
            const newMass = Math.floor(cell.mass / (splitCount + 1));
            cell.mass = newMass;
            cell.canMergeAt = now + 18000;

            for (let k = 0; k < splitCount; k++) {
              const angle = (k / splitCount) * Math.PI * 2;
              p.cells.push({
                id: Math.random(),
                x: cell.x + Math.cos(angle) * (cell.radius + 15),
                y: cell.y + Math.sin(angle) * (cell.radius + 15),
                radius: Math.sqrt(newMass * 26),
                mass: newMass,
                vx: Math.cos(angle) * 14,
                vy: Math.sin(angle) * 14,
                canMergeAt: now + 18000
              });
            }
            if (!p.isBot) {
              io.to(p.id).emit('blob_sound', 'absorbed');
            }
          }
        }
      });
    });
  }

  // 4. Absorption Cellule vs Cellule
  const allPlayers = Object.values(blobState.players).filter(p => p.isAlive);
  for (let i = 0; i < allPlayers.length; i++) {
    for (let j = 0; j < allPlayers.length; j++) {
      if (i === j) continue;
      const pA = allPlayers[i];
      const pB = allPlayers[j];

      for (let ci = 0; ci < pA.cells.length; ci++) {
        const cellA = pA.cells[ci];
        if (!cellA) continue;

        for (let cj = pB.cells.length - 1; cj >= 0; cj--) {
          const cellB = pB.cells[cj];
          if (!cellB) continue;

          const d = Math.hypot(cellA.x - cellB.x, cellA.y - cellB.y);
          if (d < cellA.radius && cellA.mass > cellB.mass * 1.15) {
            cellA.mass += cellB.mass;
            pB.cells.splice(cj, 1);

            if (!pA.isBot) {
              io.to(pA.id).emit('blob_sound', 'eat');
            }

            if (pB.cells.length === 0) {
              pB.isAlive = false;
              pB.killedBy = pA.name;
              io.to('blob_room').emit('blob_feed', `${pA.name} a dévoré ${pB.name} !`);
              if (!pB.isBot) {
                io.to(pB.id).emit('blob_sound', 'absorbed');
              }
            }
          }
        }
      }
    }
  }
}

// ==========================================
// CONFIGURATION & GESTION DU JEU BRICK BLAST 1v1
// ==========================================
const brickRooms = {
  p1: null, // Socket ID du Joueur 1
  p2: null, // Socket ID du Joueur 2
  spectators: new Set(),
  data: {
    p1: { score: 0, lives: 3, bricksLeft: 54 },
    p2: { score: 0, lives: 3, bricksLeft: 54, isBot: true }
  }
};

let brickBotSimulationInterval = null;

function resetBrickBot() {
  brickRooms.data.p2 = {
    score: 0,
    lives: 3,
    bricksLeft: 54,
    isBot: true
  };
}

// Simulation du bot IA pour Brick Blast en solo
function startBrickBotSimulation() {
  if (brickBotSimulationInterval) return;

  brickBotSimulationInterval = setInterval(() => {
    if (!brickRooms.p1 || brickRooms.p2) {
      if (brickBotSimulationInterval) {
        clearInterval(brickBotSimulationInterval);
        brickBotSimulationInterval = null;
      }
      return;
    }

    const bot = brickRooms.data.p2;
    if (bot.bricksLeft > 0 && bot.lives > 0) {
      const destroyed = Math.random() > 0.4 ? 2 : 1;
      bot.bricksLeft = Math.max(0, bot.bricksLeft - destroyed);
      bot.score += destroyed * (100 + Math.floor(Math.random() * 150));

      if (Math.random() < 0.05 && bot.lives > 1) {
        bot.lives--;
      }

      if (brickRooms.p1) {
        io.to(brickRooms.p1).emit('brick_rival_update', {
          name: '🤖 BlastBot',
          score: bot.score,
          lives: bot.lives,
          bricksLeft: bot.bricksLeft,
          isWinner: bot.bricksLeft === 0
        });
      }
    }
  }, 2200);
}

function handleBrickDisconnect(socketId) {
  let changed = false;

  if (socketId === brickRooms.p1) {
    changed = true;
    if (brickRooms.p2 && isSocketActive(brickRooms.p2)) {
      brickRooms.p1 = brickRooms.p2;
      brickRooms.p2 = null;
      io.to(brickRooms.p1).emit('brick_role', { role: 'p1', isDuel: false, rivalName: '🤖 BlastBot' });

      for (const nextUser of Array.from(brickRooms.spectators)) {
        brickRooms.spectators.delete(nextUser);
        if (isSocketActive(nextUser)) {
          brickRooms.p2 = nextUser;
          io.to(nextUser).emit('brick_role', { role: 'p2', isDuel: true, rivalName: 'Joueur 1' });
          io.to(brickRooms.p1).emit('brick_role', { role: 'p1', isDuel: true, rivalName: 'Joueur 2' });
          break;
        }
      }
    } else {
      brickRooms.p1 = null;
      brickRooms.p2 = null;
      resetBrickBot();
    }
  } else if (socketId === brickRooms.p2) {
    changed = true;
    brickRooms.p2 = null;

    let promoted = false;
    for (const nextUser of Array.from(brickRooms.spectators)) {
      brickRooms.spectators.delete(nextUser);
      if (isSocketActive(nextUser)) {
        brickRooms.p2 = nextUser;
        io.to(nextUser).emit('brick_role', { role: 'p2', isDuel: true, rivalName: 'Joueur 1' });
        promoted = true;
        break;
      }
    }

    if (!promoted && brickRooms.p1) {
      resetBrickBot();
      io.to(brickRooms.p1).emit('brick_role', { role: 'p1', isDuel: false, rivalName: '🤖 BlastBot' });
      startBrickBotSimulation();
    }
  } else if (brickRooms.spectators.has(socketId)) {
    brickRooms.spectators.delete(socketId);
    changed = true;
  }

  if (changed) {
    broadcastHubStats();
  }
}

function cleanBrickRooms() {
  let changed = false;
  if (brickRooms.p1 && !isSocketActive(brickRooms.p1)) {
    handleBrickDisconnect(brickRooms.p1);
    changed = true;
  }
  if (brickRooms.p2 && !isSocketActive(brickRooms.p2)) {
    handleBrickDisconnect(brickRooms.p2);
    changed = true;
  }
  for (const specId of Array.from(brickRooms.spectators)) {
    if (!isSocketActive(specId)) {
      brickRooms.spectators.delete(specId);
      changed = true;
    }
  }
  return changed;
}

function getActiveBrickPlayersCount() {
  cleanBrickRooms();
  let count = 0;
  if (brickRooms.p1 && isSocketActive(brickRooms.p1)) count++;
  if (brickRooms.p2 && isSocketActive(brickRooms.p2)) count++;
  return count;
}

function getHubStats() {
  const total = io.engine ? io.engine.clientsCount : (io.sockets?.sockets?.size || 0);
  return {
    totalOnline: total,
    tankPlayers: getActiveTankPlayersCount(),
    pongPlayers: getActivePongPlayersCount(),
    blobPlayers: getActiveBlobPlayersCount(),
    brickPlayers: getActiveBrickPlayersCount()
  };
}

function broadcastHubStats() {
  io.emit('hub_stats', getHubStats());
}

// Diffusion régulière des statistiques du hub
setInterval(broadcastHubStats, 2500);

// ==========================================
// GESTION DES CONNEXIONS SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log(`[+] Joueur connecté: ${socket.id}`);

  // Envoi immédiat des statistiques du hub au nouveau client
  socket.emit('hub_stats', getHubStats());
  broadcastHubStats();

  // Envoi de la configuration initiale de la carte Tank
  socket.emit('init_map', {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    walls: WALLS
  });

  // --- Événements Tank Clash ---
  socket.on('join_game', (data) => {
    const spawn = getSafeSpawn();
    const colorIndex = Object.keys(gameState.players).length % TANK_COLORS.length;
    const playerColor = data.color || TANK_COLORS[colorIndex];

    gameState.players[socket.id] = {
      id: socket.id,
      name: (data.name || 'Tankiste').substring(0, 15),
      color: playerColor,
      x: spawn.x,
      y: spawn.y,
      bodyAngle: 0,
      turretAngle: 0,
      radius: 24,
      width: 44,
      height: 36,
      health: 150,
      maxHealth: 150,
      isAlive: true,
      kills: 0,
      deaths: 0,
      score: 0,
      shield: Date.now() + 2500, // Bouclier d'invulnérabilité au spawn (2.5s)
      shieldHits: 0, // Charges du bouclier bonus (détruit à l'impact)
      shieldExpiresAt: 0,
      speedMultiplier: 1.0,
      rapidFireUntil: 0,
      tripleShotUntil: 0,
      lastShotTime: 0,
      inputs: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        turretAngle: 0,
        shoot: false,
        controlMode: 'fluid'
      }
    };

    socket.emit('joined', { id: socket.id });
    io.emit('chat_message', {
      sender: 'Serveur',
      text: `${gameState.players[socket.id].name} a rejoint la bataille !`,
      color: '#4ade80'
    });
    manageBots();
    broadcastHubStats();
  });

  socket.on('player_input', (inputData) => {
    const player = gameState.players[socket.id];
    if (player && player.isAlive && inputData) {
      player.inputs = inputData;
      if (typeof inputData.turretAngle === 'number') {
        player.turretAngle = inputData.turretAngle;
      }

      if (inputData.shoot) {
        attemptShoot(player);
      }
    }
  });

  socket.on('leave_game', () => {
    if (gameState.players[socket.id]) {
      const name = gameState.players[socket.id].name;
      delete gameState.players[socket.id];
      io.emit('chat_message', {
        sender: 'Serveur',
        text: `${name} a quitté l'arène.`,
        color: '#f87171'
      });
      manageBots();
      broadcastHubStats();
    }
  });

  // --- Événements Neon Pong 1v1 ---
  socket.on('pong_join', () => {
    cleanPongRooms();
    socket.join('pong_room');

    if (pongRooms.p1 === socket.id) {
      socket.emit('pong_role', { role: 'p1' });
    } else if (pongRooms.p2 === socket.id) {
      socket.emit('pong_role', { role: 'p2' });
    } else if (!pongRooms.p1) {
      pongRooms.p1 = socket.id;
      socket.emit('pong_role', { role: 'p1' });
    } else if (!pongRooms.p2) {
      pongRooms.p2 = socket.id;
      socket.emit('pong_role', { role: 'p2' });
    } else {
      pongRooms.spectators.add(socket.id);
      socket.emit('pong_role', { role: 'spectator' });
    }

    updatePongNamesAndRoles();
    socket.emit('pong_state', pongState);
    broadcastHubStats();
  });

  socket.on('pong_leave', () => {
    handlePongDisconnect(socket.id);
    socket.leave('pong_room');
    broadcastHubStats();
  });

  socket.on('pong_input', (inputData) => {
    if (socket.id !== pongRooms.p1 && socket.id !== pongRooms.p2) return;
    pongRooms.inputs[socket.id] = inputData;
  });

  socket.on('pong_paddle_move', (data) => {
    if (socket.id !== pongRooms.p1 && socket.id !== pongRooms.p2) return;
    if (typeof data?.y !== 'number') return;
    const clampedY = Math.max(0, Math.min(PONG_HEIGHT - PADDLE_HEIGHT, data.y));
    if (socket.id === pongRooms.p1) {
      pongState.p1.y = clampedY;
    } else if (socket.id === pongRooms.p2) {
      pongState.p2.y = clampedY;
    }
  });

  socket.on('pong_restart', () => {
    if (socket.id === pongRooms.p1 || socket.id === pongRooms.p2) {
      resetPongMatch();
      io.to('pong_room').emit('pong_state', pongState);
    }
  });

  // --- Événements Blob Clash (Agar.io) ---
  socket.on('blob_join', (data) => {
    socket.join('blob_room');
    const spawn = getSafeBlobSpawn();
    const color = data?.color || '#10b981';
    const name = (data?.name || 'Cellule').substring(0, 15);

    blobState.players[socket.id] = {
      id: socket.id,
      name: name,
      color: color,
      isBot: false,
      isAlive: true,
      killedBy: null,
      target: { x: spawn.x, y: spawn.y },
      cells: [{
        id: 1,
        x: spawn.x,
        y: spawn.y,
        radius: 22,
        mass: 20,
        vx: 0,
        vy: 0,
        canMergeAt: 0
      }]
    };

    socket.emit('blob_init', {
      myId: socket.id,
      map: { width: BLOB_MAP_WIDTH, height: BLOB_MAP_HEIGHT },
      viruses: blobState.viruses,
      food: Array.from(blobState.food.values())
    });

    broadcastHubStats();
  });

  socket.on('blob_target', (coords) => {
    const p = blobState.players[socket.id];
    if (p && p.isAlive && typeof coords?.x === 'number' && typeof coords?.y === 'number') {
      p.target.x = coords.x;
      p.target.y = coords.y;
    }
  });

  socket.on('blob_split', () => {
    const p = blobState.players[socket.id];
    if (!p || !p.isAlive) return;
    const now = Date.now();
    const originalCells = [...p.cells];

    originalCells.forEach(cell => {
      if (cell.mass >= 36 && p.cells.length < 8) {
        const halfMass = Math.floor(cell.mass / 2);
        cell.mass = halfMass;
        cell.canMergeAt = now + 15000;

        const dx = p.target.x - cell.x;
        const dy = p.target.y - cell.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;

        p.cells.push({
          id: Math.random(),
          x: cell.x + dirX * (cell.radius + 15),
          y: cell.y + dirY * (cell.radius + 15),
          radius: Math.sqrt(halfMass * 26),
          mass: halfMass,
          vx: dirX * 16,
          vy: dirY * 16,
          canMergeAt: now + 15000
        });
      }
    });
    socket.emit('blob_sound', 'split');
  });

  socket.on('blob_eject', () => {
    const p = blobState.players[socket.id];
    if (!p || !p.isAlive) return;

    p.cells.forEach(cell => {
      if (cell.mass >= 30) {
        cell.mass -= 4;
        const dx = p.target.x - cell.x;
        const dy = p.target.y - cell.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;

        blobState.ejected.push({
          id: blobState.nextId++,
          x: cell.x + dirX * (cell.radius + 12),
          y: cell.y + dirY * (cell.radius + 12),
          vx: dirX * 12,
          vy: dirY * 12,
          radius: 8,
          mass: 4,
          color: p.color
        });
      }
    });
  });

  socket.on('blob_leave', () => {
    if (blobState.players[socket.id]) {
      delete blobState.players[socket.id];
    }
    socket.leave('blob_room');
    broadcastHubStats();
  });

  // --- Événements Brick Blast 1v1 ---
  socket.on('brick_join', () => {
    cleanBrickRooms();
    socket.join('brick_room');

    if (!brickRooms.p1) {
      brickRooms.p1 = socket.id;
      resetBrickBot();
      socket.emit('brick_role', { role: 'p1', isDuel: false, rivalName: '🤖 BlastBot' });
      startBrickBotSimulation();
    } else if (!brickRooms.p2) {
      brickRooms.p2 = socket.id;
      socket.emit('brick_role', { role: 'p2', isDuel: true, rivalName: 'Joueur 1' });
      io.to(brickRooms.p1).emit('brick_role', { role: 'p1', isDuel: true, rivalName: 'Joueur 2' });
    } else {
      brickRooms.spectators.add(socket.id);
      socket.emit('brick_role', { role: 'spectator', isDuel: true, rivalName: 'Match 1v1 en cours' });
    }

    broadcastHubStats();
  });

  socket.on('brick_progress', (data) => {
    if (socket.id === brickRooms.p1 && brickRooms.p2) {
      io.to(brickRooms.p2).emit('brick_rival_update', {
        name: 'Joueur 1',
        score: data.score,
        lives: data.lives,
        bricksLeft: data.bricksLeft,
        isWinner: data.bricksLeft === 0
      });
    } else if (socket.id === brickRooms.p2 && brickRooms.p1) {
      io.to(brickRooms.p1).emit('brick_rival_update', {
        name: 'Joueur 2',
        score: data.score,
        lives: data.lives,
        bricksLeft: data.bricksLeft,
        isWinner: data.bricksLeft === 0
      });
    }
  });

  socket.on('brick_game_over', (data) => {
    const rival = socket.id === brickRooms.p1 ? brickRooms.p2 : brickRooms.p1;
    if (rival) {
      io.to(rival).emit('brick_rival_update', {
        name: socket.id === brickRooms.p1 ? 'Joueur 1' : 'Joueur 2',
        isWinner: !data.won
      });
    }
  });

  socket.on('brick_leave', () => {
    handleBrickDisconnect(socket.id);
    socket.leave('brick_room');
    broadcastHubStats();
  });

  // --- Déconnexion ---
  socket.on('disconnect', () => {
    if (gameState.players[socket.id]) {
      const name = gameState.players[socket.id].name;
      delete gameState.players[socket.id];
      io.emit('chat_message', {
        sender: 'Serveur',
        text: `${name} a quitté l'arène.`,
        color: '#f87171'
      });
      manageBots();
    }
    handlePongDisconnect(socket.id);
    handleBrickDisconnect(socket.id);
    if (blobState.players[socket.id]) {
      delete blobState.players[socket.id];
    }
    broadcastHubStats();
    console.log(`[-] Joueur déconnecté: ${socket.id}`);
  });
});

function attemptShoot(player) {
  const now = Date.now();
  const cooldown = now < player.rapidFireUntil ? 160 : 380;

  if (now - player.lastShotTime < cooldown) return;
  player.lastShotTime = now;

  const barrelLength = 32;
  const isTriple = now < player.tripleShotUntil;
  const aimAngle = (typeof player.turretAngle === 'number') ? player.turretAngle : player.bodyAngle;

  const angles = isTriple 
    ? [aimAngle - 0.22, aimAngle, aimAngle + 0.22]
    : [aimAngle];

  angles.forEach(angle => {
    const bulletSpeed = 12.5;
    const bx = player.x + Math.cos(angle) * barrelLength;
    const by = player.y + Math.sin(angle) * barrelLength;

    gameState.bullets.push({
      id: gameState.nextBulletId++,
      playerId: player.id,
      playerColor: player.color,
      x: bx,
      y: by,
      vx: Math.cos(angle) * bulletSpeed,
      vy: Math.sin(angle) * bulletSpeed,
      radius: 5,
      bouncesLeft: 1, // 1 rebond sur les murs façon "Wii Tanks" !
      createdAt: now,
      life: 240 // Ticks de durée de vie (~4 sec)
    });
  });

  io.emit('sound_event', { type: 'shoot', x: player.x, y: player.y });
}

// Boucle principale de simulation (60 Ticks / seconde)
const TICK_RATE = 60;
setInterval(() => {
  updateGamePhysics();
}, 1000 / TICK_RATE);

// Diffusion réseau ultra-optimisée vers les clients (40 fois / seconde)
setInterval(() => {
  const now = Date.now();
  const minimalPlayers = {};
  for (const id in gameState.players) {
    const p = gameState.players[id];
    minimalPlayers[id] = {
      name: p.name,
      color: p.color,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      bodyAngle: Math.round(p.bodyAngle * 1000) / 1000,
      turretAngle: Math.round((p.turretAngle !== undefined ? p.turretAngle : p.bodyAngle) * 1000) / 1000,
      health: p.health,
      maxHealth: p.maxHealth,
      isAlive: p.isAlive,
      hasShield: (now < (p.shield || 0)) || ((p.shieldHits || 0) > 0 && now < (p.shieldExpiresAt || 0)),
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      respawnAt: p.respawnAt || 0,
      speedMultiplier: p.speedMultiplier || 1.0,
      rapidFireUntil: p.rapidFireUntil || 0,
      tripleShotUntil: p.tripleShotUntil || 0
    };
  }

  const minimalBullets = gameState.bullets.map(b => ({
    id: b.id,
    playerId: b.playerId,
    playerColor: b.playerColor,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10,
    radius: b.radius
  }));

  io.emit('game_state', {
    timestamp: now,
    players: minimalPlayers,
    bullets: minimalBullets,
    explosions: gameState.explosions,
    powerups: gameState.powerups
  });

  // Nettoyage des explosions après diffusion
  gameState.explosions = [];
}, 1000 / 35);

// Boucle principale de simulation Pong (60 Ticks / seconde)
setInterval(() => {
  updatePongPhysics();
}, 1000 / TICK_RATE);

// Diffusion réseau Pong vers la salle 'pong_room' (35 fois / seconde)
setInterval(() => {
  if (pongRooms.p1) {
    io.to('pong_room').emit('pong_state', pongState);
  }
}, 1000 / 35);

// Boucle principale de simulation Blob Clash (45 Ticks / seconde)
setInterval(() => {
  updateBlobPhysics();
}, 1000 / 45);

// Diffusion réseau Blob Clash vers 'blob_room' (30 fois / seconde)
setInterval(() => {
  const humanCount = Object.values(blobState.players).filter(p => !p.isBot).length;
  if (humanCount === 0) return;

  const leaderboard = Object.values(blobState.players)
    .filter(p => p.isAlive && p.cells && p.cells.length > 0)
    .map(p => ({
      id: p.id,
      name: p.name,
      mass: p.cells.reduce((sum, c) => sum + c.mass, 0)
    }))
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 5);

  const minimalPlayers = {};
  for (const id in blobState.players) {
    const p = blobState.players[id];
    minimalPlayers[id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      isAlive: p.isAlive,
      killedBy: p.killedBy,
      cells: (p.cells || []).map(c => ({
        x: Math.round(c.x),
        y: Math.round(c.y),
        radius: Math.round(c.radius),
        mass: Math.round(c.mass)
      }))
    };
  }

  io.to('blob_room').emit('blob_state', {
    players: minimalPlayers,
    ejected: blobState.ejected.map(e => ({ x: Math.round(e.x), y: Math.round(e.y), color: e.color, radius: e.radius })),
    leaderboard
  });

  if (blobFoodDelta.eaten.length > 0 || blobFoodDelta.added.length > 0) {
    io.to('blob_room').emit('blob_food_sync', {
      eaten: blobFoodDelta.eaten,
      added: blobFoodDelta.added
    });
    blobFoodDelta.eaten = [];
    blobFoodDelta.added = [];
  }
}, 1000 / 30);

let botCheckTimer = 0;

function updateGamePhysics() {
  const now = Date.now();

  // Vérifier et actualiser les bots toutes les 60 ticks (~1 seconde)
  if (++botCheckTimer >= 60) {
    botCheckTimer = 0;
    manageBots();
  }

  // Mettre à jour l'IA des bots actifs
  for (const id in gameState.players) {
    const p = gameState.players[id];
    if (p.isBot && p.isAlive) {
      updateBotAI(p, now);
    }
  }

  // 1. Déplacement des Tanks
  for (const id in gameState.players) {
    const player = gameState.players[id];
    if (!player.isAlive) {
      if (player.respawnAt && now >= player.respawnAt) {
        respawnPlayer(player);
      }
      continue;
    }

    const baseSpeed = 3.8 * (player.speedMultiplier || 1.0);
    const turnSpeed = 0.065;

    let moveX = 0;
    let moveY = 0;

    const isClassic = player.isBot || (player.inputs && player.inputs.controlMode === 'classic');

    if (isClassic) {
      // Rotation du châssis en mode tank classique
      if (player.inputs.left) player.bodyAngle -= turnSpeed;
      if (player.inputs.right) player.bodyAngle += turnSpeed;
      if (!player.isBot && typeof player.inputs.turretAngle !== 'number') {
        player.turretAngle = player.bodyAngle;
      }

      if (player.inputs.forward) {
        moveX += Math.cos(player.bodyAngle) * baseSpeed;
        moveY += Math.sin(player.bodyAngle) * baseSpeed;
      }
      if (player.inputs.backward) {
        moveX -= Math.cos(player.bodyAngle) * (baseSpeed * 0.65);
        moveY -= Math.sin(player.bodyAngle) * (baseSpeed * 0.65);
      }
    } else {
      // Mode Fluide Moderne (ZQSD directionnel / joysticks)
      let dx = 0;
      let dy = 0;
      if (player.inputs.up || player.inputs.forward) dy -= 1;
      if (player.inputs.down || player.inputs.backward) dy += 1;
      if (player.inputs.left) dx -= 1;
      if (player.inputs.right) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        moveX = (dx / len) * baseSpeed;
        moveY = (dy / len) * baseSpeed;

        // Rotation fluide et naturelle du châssis vers la direction de course
        const targetMoveAngle = Math.atan2(dy, dx);
        let diff = (targetMoveAngle - player.bodyAngle) % (Math.PI * 2);
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > Math.PI) diff -= Math.PI * 2;
        player.bodyAngle += diff * 0.22;
      }

      // Si la tourelle n'est pas encore orientée à la souris, elle suit le châssis
      if (typeof player.turretAngle !== 'number') {
        player.turretAngle = player.bodyAngle;
      }
    }

    // Application du déplacement avec vérification des collisions de murs (glissement fluide)
    const nextX = player.x + moveX;
    const nextY = player.y + moveY;

    // Collision axe X
    let canMoveX = true;
    for (const wall of WALLS) {
      if (checkRectCircle(wall, nextX, player.y, player.radius)) {
        canMoveX = false;
        break;
      }
    }
    if (canMoveX) player.x = nextX;

    // Collision axe Y
    let canMoveY = true;
    for (const wall of WALLS) {
      if (checkRectCircle(wall, player.x, nextY, player.radius)) {
        canMoveY = false;
        break;
      }
    }
    if (canMoveY) player.y = nextY;

    // Confinement dans les bordures du champ de bataille
    player.x = Math.max(player.radius + 15, Math.min(MAP_WIDTH - player.radius - 15, player.x));
    player.y = Math.max(player.radius + 15, Math.min(MAP_HEIGHT - player.radius - 15, player.y));

    // Ramassage des powerups
    for (let i = gameState.powerups.length - 1; i >= 0; i--) {
      const pup = gameState.powerups[i];
      const dist = Math.hypot(player.x - pup.x, player.y - pup.y);
      if (dist < player.radius + pup.radius) {
        applyPowerup(player, pup);
        gameState.powerups.splice(i, 1);
      }
    }
  }

  // 2. Déplacement et physique des Projectiles
  for (let i = gameState.bullets.length - 1; i >= 0; i--) {
    const bullet = gameState.bullets[i];
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    bullet.life--;

    let destroyed = false;

    // Détection des collisions avec les murs (avec rebond)
    for (const wall of WALLS) {
      if (checkRectCircle(wall, bullet.x, bullet.y, bullet.radius)) {
        if (bullet.bouncesLeft > 0) {
          bullet.bouncesLeft--;

          // Calcul de la normale pour le rebond
          const prevX = bullet.x - bullet.vx;
          const prevY = bullet.y - bullet.vy;

          if (prevX < wall.x || prevX > wall.x + wall.width) {
            bullet.vx = -bullet.vx;
            bullet.x += bullet.vx;
          } else {
            bullet.vy = -bullet.vy;
            bullet.y += bullet.vy;
          }
          io.emit('sound_event', { type: 'ricochet', x: bullet.x, y: bullet.y });
        } else {
          destroyed = true;
          gameState.explosions.push({ x: bullet.x, y: bullet.y, radius: 15, type: 'bullet' });
        }
        break;
      }
    }

    if (!destroyed) {
      // Détection des collisions avec les tanks
      for (const id in gameState.players) {
        const player = gameState.players[id];
        if (!player.isAlive) continue;

        // Immunité totale contre ses propres balles (même après rebond)
        if (player.id === bullet.playerId) continue;

        const dist = Math.hypot(player.x - bullet.x, player.y - bullet.y);
        if (dist < player.radius + bullet.radius) {
          destroyed = true;
          gameState.explosions.push({ x: bullet.x, y: bullet.y, radius: 25, type: 'bullet' });

          // Vérifier si le tank a un bouclier actif (spawn ou bonus)
          const hasActiveShield = (now < (player.shield || 0)) || ((player.shieldHits || 0) > 0 && now < (player.shieldExpiresAt || 0));

          if (!hasActiveShield) {
            player.health -= 25; // 6 coups pour éliminer un tank (150 PV)
            io.emit('sound_event', { type: 'hit', x: player.x, y: player.y });

            if (player.health <= 0) {
              killPlayer(player, bullet.playerId);
            }
          } else {
            // Le bouclier absorbe l'impact !
            if (player.shieldHits > 0) {
              player.shieldHits--;
              if (player.shieldHits <= 0) {
                player.shieldExpiresAt = 0;
                io.emit('sound_event', { type: 'shield_broken', x: player.x, y: player.y });
                gameState.explosions.push({ x: player.x, y: player.y, radius: 45, type: 'shield_break' });
              } else {
                io.emit('sound_event', { type: 'shield_deflect', x: player.x, y: player.y });
              }
            } else {
              io.emit('sound_event', { type: 'shield_deflect', x: player.x, y: player.y });
            }
          }
          break;
        }
      }
    }

    if (destroyed || bullet.life <= 0) {
      gameState.bullets.splice(i, 1);
    }
  }
}

function applyPowerup(player, pup) {
  const now = Date.now();
  if (pup.type === 'speed') {
    player.speedMultiplier = 1.55;
    setTimeout(() => { player.speedMultiplier = 1.0; }, 8000);
    io.emit('sound_event', { type: 'powerup', x: player.x, y: player.y });
  } else if (pup.type === 'rapid') {
    player.rapidFireUntil = now + 8000;
    io.emit('sound_event', { type: 'powerup', x: player.x, y: player.y });
  } else if (pup.type === 'shield') {
    player.shieldHits = 1; // Protège le joueur jusqu'à subir un impact destructeur
    player.shieldExpiresAt = now + 40000; // Ou 40 secondes max
    io.emit('sound_event', { type: 'powerup', x: player.x, y: player.y });
  } else if (pup.type === 'triple') {
    player.tripleShotUntil = now + 8000;
    io.emit('sound_event', { type: 'powerup', x: player.x, y: player.y });
  } else if (pup.type === 'health') {
    const healAmount = 50;
    const oldHealth = player.health;
    player.health = Math.min(player.maxHealth, player.health + healAmount);
    const actualHeal = player.health - oldHealth;

    io.emit('chat_message', {
      sender: 'Soin',
      text: `💚 ${player.name} s'est réparé (+${actualHeal > 0 ? actualHeal : 50} PV) !`,
      color: '#34d399'
    });
    io.emit('sound_event', { type: 'heal', x: player.x, y: player.y });
    gameState.explosions.push({ x: player.x, y: player.y, radius: 40, type: 'heal' });
  }
}

function killPlayer(victim, killerId) {
  victim.isAlive = false;
  victim.deaths++;
  victim.respawnAt = Date.now() + 3000; // Respawn après 3 secondes

  const killer = gameState.players[killerId];
  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.score += 100;
    io.emit('chat_message', {
      sender: 'Bataille',
      text: `${killer.name} a pulvérisé ${victim.name} !`,
      color: '#fbbf24'
    });
  } else {
    io.emit('chat_message', {
      sender: 'Bataille',
      text: `${victim.name} s'est auto-détruit !`,
      color: '#94a3b8'
    });
  }

  gameState.explosions.push({ x: victim.x, y: victim.y, radius: 55, type: 'tank' });
  io.emit('sound_event', { type: 'tank_destroyed', x: victim.x, y: victim.y });
}

function respawnPlayer(player) {
  const spawn = getSafeSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.health = player.maxHealth;
  player.isAlive = true;
  player.shield = Date.now() + 2500;
  player.shieldHits = 0;
  player.shieldExpiresAt = 0;
  player.speedMultiplier = 1.0;
  player.rapidFireUntil = 0;
  player.tripleShotUntil = 0;
}

// Obtenir l'IP locale pour l'accès multijoueur sur d'autres appareils
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const addr of interfaces[k]) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n======================================================');
  console.log('       🎮 SERVEUR DE JEU DE TANK 2D MULTIJOUEUR        ');
  console.log('======================================================');
  console.log(`> En local sur cette machine : http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`> Depuis d'autres appareils sur le Wi-Fi (LAN) :`);
    ips.forEach(ip => {
      console.log(`   👉 http://${ip}:${PORT}`);
    });
  }
  console.log('======================================================\n');
});

