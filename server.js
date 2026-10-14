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

io.on('connection', (socket) => {
  console.log(`[+] Joueur connecté: ${socket.id}`);

  // Envoi de la configuration initiale de la carte
  socket.emit('init_map', {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    walls: WALLS
  });

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
  });

  socket.on('player_input', (inputData) => {
    const player = gameState.players[socket.id];
    if (player && player.isAlive) {
      player.inputs = inputData;
      // Tourelle fixe : alignée en permanence avec l'orientation du châssis
      player.turretAngle = player.bodyAngle;

      if (inputData.shoot) {
        attemptShoot(player);
      }
    }
  });

  socket.on('disconnect', () => {
    if (gameState.players[socket.id]) {
      const name = gameState.players[socket.id].name;
      delete gameState.players[socket.id];
      io.emit('chat_message', {
        sender: 'Serveur',
        text: `${name} a quitté l'arène.`,
        color: '#f87171'
      });
    }
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
      shield: p.shield > now,
      shieldTime: p.shield,
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
}, 1000 / 60);

function updateGamePhysics() {
  const now = Date.now();

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

          // Vérifier si le tank a un bouclier actif
          if (now > player.shield) {
            player.health -= 34; // 3 coups pour éliminer un tank
            io.emit('sound_event', { type: 'hit', x: player.x, y: player.y });

            if (player.health <= 0) {
              killPlayer(player, bullet.playerId);
            }
          } else {
            io.emit('sound_event', { type: 'shield_deflect', x: player.x, y: player.y });
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
    player.shield = now + 7000;
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

