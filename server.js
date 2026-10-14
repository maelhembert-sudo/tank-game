const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
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
  if (gameState.powerups.length >= 4) return;
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

// Spawner un powerup toutes les 12 secondes
setInterval(spawnPowerup, 12000);

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
          health: 100,
          maxHealth: 100,
          isAlive: true,
          kills: 0,
          deaths: 0,
          score: 0,
          shield: Date.now() + 2500,
          shieldHits: 0,
          shieldExpiresAt: 0,
          speedMultiplier: 0.82, // Vitesse équilibrée pour un combat dynamique et amusant
          rapidFireUntil: 0,
          tripleShotUntil: 0,
          lastShotTime: 0,
          inputs: { forward: false, backward: false, left: false, right: false, shoot: false },
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

  const angleToTarget = Math.atan2(nearestTarget.y - bot.y, nearestTarget.x - bot.x);
  let diff = (angleToTarget - bot.bodyAngle) % (Math.PI * 2);
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

    // Rotation fluide vers la cible
    if (Math.abs(diff) > 0.08) {
      bot.inputs.left = diff < 0;
      bot.inputs.right = diff > 0;
    } else {
      bot.inputs.left = false;
      bot.inputs.right = false;
    }

    // Distance d'engagement tactique
    const targetDist = Math.hypot(nearestTarget.x - bot.x, nearestTarget.y - bot.y);
    if (targetDist > bot.ai.preferredDistance) {
      bot.inputs.forward = true;
    } else if (targetDist < 140) {
      bot.inputs.backward = true;
    } else {
      bot.inputs.forward = false;
    }
  }

  // Décision de tir (aligné vers la cible et à bonne portée)
  const realDist = Math.hypot(nearestTarget.x - bot.x, nearestTarget.y - bot.y);
  if (Math.abs(diff) < 0.22 && realDist < 600 && bot.ai.reverseCooldown === 0) {
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

function handlePongDisconnect(socketId) {
  let changed = false;

  if (pongRooms.inputs[socketId]) {
    delete pongRooms.inputs[socketId];
  }

  if (socketId === pongRooms.p1) {
    changed = true;
    if (pongRooms.p2) {
      pongRooms.p1 = pongRooms.p2;
      pongRooms.p2 = null;
      io.to(pongRooms.p1).emit('pong_role', { role: 'p1' });

      if (pongRooms.spectators.size > 0) {
        const nextUser = pongRooms.spectators.values().next().value;
        pongRooms.spectators.delete(nextUser);
        pongRooms.p2 = nextUser;
        io.to(nextUser).emit('pong_role', { role: 'p2' });
      }
    } else {
      pongRooms.p1 = null;
      resetPongMatch();
    }
  } else if (socketId === pongRooms.p2) {
    changed = true;
    pongRooms.p2 = null;

    if (pongRooms.spectators.size > 0) {
      const nextUser = pongRooms.spectators.values().next().value;
      pongRooms.spectators.delete(nextUser);
      pongRooms.p2 = nextUser;
      io.to(nextUser).emit('pong_role', { role: 'p2' });
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

// ==========================================
// STATISTIQUES DU HUB EN DIRECT
// ==========================================
function getActiveTankPlayersCount() {
  return Object.values(gameState.players).filter(p => !p.isBot).length;
}

function getActivePongPlayersCount() {
  let count = 0;
  if (pongRooms.p1) count++;
  if (pongRooms.p2) count++;
  return count;
}

function getHubStats() {
  const total = io.engine ? io.engine.clientsCount : (io.sockets?.sockets?.size || 0);
  return {
    totalOnline: total,
    tankPlayers: getActiveTankPlayersCount(),
    pongPlayers: getActivePongPlayersCount()
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
      health: 100,
      maxHealth: 100,
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
        turretAngle: 0,
        shoot: false
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
    if (player && player.isAlive) {
      player.inputs = inputData;
      player.turretAngle = player.bodyAngle;

      if (inputData.shoot) {
        attemptShoot(player);
      }
    }
  });

  // --- Événements Neon Pong 1v1 ---
  socket.on('pong_join', () => {
    socket.join('pong_room');

    if (!pongRooms.p1) {
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
  const aimAngle = player.bodyAngle;

  const angles = isTriple 
    ? [aimAngle - 0.22, aimAngle, aimAngle + 0.22]
    : [aimAngle];

  angles.forEach(angle => {
    const bulletSpeed = 12;
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

    const baseSpeed = 3.6 * (player.speedMultiplier || 1.0);
    const turnSpeed = 0.055;

    // Rotation du châssis (et tourelle fixe alignée)
    if (player.inputs.left) player.bodyAngle -= turnSpeed;
    if (player.inputs.right) player.bodyAngle += turnSpeed;
    player.turretAngle = player.bodyAngle;

    let moveX = 0;
    let moveY = 0;

    if (player.inputs.forward) {
      moveX += Math.cos(player.bodyAngle) * baseSpeed;
      moveY += Math.sin(player.bodyAngle) * baseSpeed;
    }
    if (player.inputs.backward) {
      moveX -= Math.cos(player.bodyAngle) * (baseSpeed * 0.65);
      moveY -= Math.sin(player.bodyAngle) * (baseSpeed * 0.65);
    }

    // Application du déplacement avec vérification des collisions de murs
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

    // Ramassage des powerups
    for (let i = gameState.powerups.length - 1; i >= 0; i--) {
      const pup = gameState.powerups[i];
      const dist = Math.hypot(player.x - pup.x, player.y - pup.y);
      if (dist < player.radius + pup.radius) {
        applyPowerup(player, pup);
        gameState.powerups.splice(i, 1);
        io.emit('sound_event', { type: 'powerup', x: player.x, y: player.y });
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
            player.health -= 34; // 3 coups pour éliminer un tank
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
    player.speedMultiplier = 1.6;
    setTimeout(() => { player.speedMultiplier = 1.0; }, 8000);
  } else if (pup.type === 'rapid') {
    player.rapidFireUntil = now + 8000;
  } else if (pup.type === 'shield') {
    player.shieldHits = 1; // Protège le joueur jusqu'à subir un impact destructeur
    player.shieldExpiresAt = now + 40000; // Ou 40 secondes max
  } else if (pup.type === 'triple') {
    player.tripleShotUntil = now + 8000;
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

