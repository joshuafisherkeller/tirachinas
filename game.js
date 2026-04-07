// ¡Resortera Ranchera!
// Single-file canvas game

(function () {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // ─── Resize ────────────────────────────────────────────────────────────────
  function resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const aspect = 16 / 9;
    let cw, ch;
    if (W / H >= aspect) {
      ch = H;
      cw = Math.round(H * aspect);
    } else {
      cw = W;
      ch = Math.round(W / aspect);
    }
    canvas.width  = cw;
    canvas.height = ch;
    canvas.style.left = Math.round((W - cw) / 2) + 'px';
    canvas.style.top  = Math.round((H - ch) / 2) + 'px';
  }
  window.addEventListener('resize', () => { resize(); });
  resize();

  // ─── Utility ───────────────────────────────────────────────────────────────
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  // ─── Background image ──────────────────────────────────────────────────────
  const bgImage = new Image();
  bgImage.src = 'farm.jpg';
  let bgLoaded = false;
  bgImage.onload  = () => { bgLoaded = true; };
  bgImage.onerror = () => { bgLoaded = false; };

  // ─── Game object ───────────────────────────────────────────────────────────
  const Game = {
    state: 'menu',           // menu | playing | round_end | game_over
    round: 1,
    score: 0,
    highScore: parseInt(localStorage.getItem('resortera_hs') || '0', 10),
    chickens: 10,            // count – kept in sync with chickenObjects
    chickenObjects: [],      // actual entities
    dogs: [],
    projectiles: [],
    particles: [],
    floatingTexts: [],

    dogsSpawned: 0,
    dogsTotal: 0,
    spawnTimer: 0,
    spawnInterval: 2.2,
    isBossRound: false,
    bossSpawned: false,

    // ── Rooster power-up ──────────────────────────────────────────────────────
    rooster: {
      active: false, x: 0, y: 0, vx: 0,
      animTimer: 0, scared: false, spawnCountdown: 20,
    },

    aimX: 0,
    aimY: 0,
    sling: { pulling: false, pullX: 0, pullY: 0 },
    lastShot: 1,
    cooldown: 0.4,

    // round-end bookkeeping
    roundLostChickens: 0,
    prevChickenCount: 0,

    blinkTimer: 0,
    blinkVisible: true,

    // ── Init ────────────────────────────────────────────────────────────────
    init() {
      this.aimX = canvas.width  / 2;
      this.aimY = canvas.height / 2;
      this.bindEvents();
      requestAnimationFrame((ts) => this.loop(ts));
    },

    // ── Game loop ───────────────────────────────────────────────────────────
    loop(timestamp) {
      if (!this._lastTs) this._lastTs = timestamp;
      let dt = (timestamp - this._lastTs) / 1000;
      this._lastTs = timestamp;
      dt = Math.min(dt, 0.05);

      this.blinkTimer += dt;
      if (this.blinkTimer > 0.6) { this.blinkTimer = 0; this.blinkVisible = !this.blinkVisible; }

      if (this.state === 'playing') this.update(dt);

      this.draw();
      requestAnimationFrame((ts) => this.loop(ts));
    },

    // ── Update ──────────────────────────────────────────────────────────────
    update(dt) {
      this.lastShot += dt;
      this.updateProjectiles(dt);
      this.updateDogs(dt);
      this.updateChickens(dt);
      this.updateRooster(dt);
      this.updateParticles(dt);
      this.updateFloatingTexts(dt);

      // spawn dogs
      if (this.dogsSpawned < this.dogsTotal) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnDog();
          this.spawnTimer = this.spawnInterval;
        }
      }
    },

    // ── Start / Round management ────────────────────────────────────────────
    startGame() {
      this.round     = 1;
      this.score     = 0;
      this.chickens  = 10;
      this.dogs      = [];
      this.projectiles = [];
      this.particles   = [];
      this.floatingTexts = [];
      this.chickenObjects = [];
      this.rooster.active = false;
      this.rooster.spawnCountdown = rand(15, 25);
      this.spawnChickens(10);
      this.startRound();
    },

    startRound() {
      this.state        = 'playing';
      this.dogs         = [];
      this.projectiles  = [];
      this.dogsSpawned  = 0;
      this.isBossRound  = (this.round % 4 === 0);
      this.bossSpawned  = false;
      // dog count: ramps quickly; boss rounds get +1 slot for the boss
      const baseDogs    = 2 + Math.floor(this.round * 1.8);
      this.dogsTotal    = this.isBossRound ? 1 : baseDogs;
      this.spawnInterval = Math.max(0.55, 2.0 - this.round * 0.12);
      this.spawnTimer   = 1.2;
      this.prevChickenCount = this.chickenObjects.filter(c => c.alive).length;
      this.roundLostChickens = 0;
      this.rooster.active = false;
      this.rooster.scared = false;
      this.rooster.spawnCountdown = rand(12, 22);

      if (this.isBossRound) {
        this.addFloatingText('¡JEFE PERRO!', canvas.width / 2, canvas.height * 0.28, '#FF2222', 3.5, 64);
        this.addFloatingText('Round ' + this.round, canvas.width / 2, canvas.height * 0.42, '#FFD700', 2.5, 38);
      } else {
        this.addFloatingText('Round ' + this.round, canvas.width / 2, canvas.height * 0.3, '#FFD700', 2.5, 52);
      }
    },

    endRound() {
      if (this.state !== 'playing') return;
      this.state = 'round_end';
      const alive = this.chickenObjects.filter(c => c.alive).length;
      this.roundLostChickens = this.prevChickenCount - alive;
    },

    nextRound() {
      const alive = this.chickenObjects.filter(c => c.alive).length;
      const newCount = alive + 2;
      this.chickenObjects = [];
      this.spawnChickens(newCount);
      this.chickens = newCount;
      this.round++;
      this.startRound();
    },

    gameOver() {
      this.state = 'game_over';
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem('resortera_hs', this.highScore);
      }
    },

    // ── Chicken management ──────────────────────────────────────────────────
    spawnChickens(count) {
      const zoneTop    = canvas.height * 0.55;
      const zoneBottom = canvas.height * 0.88;
      for (let i = 0; i < count; i++) {
        this.chickenObjects.push({
          x: rand(60, canvas.width - 60),
          y: rand(zoneTop, zoneBottom),
          alive: true,
          animTimer: rand(0, Math.PI * 2),
          scatterVx: 0,
          scatterVy: 0,
          eating: false,
          eatTimer: 0,
        });
      }
      this.chickens = this.chickenObjects.filter(c => c.alive).length;
    },

    updateChickens(dt) {
      for (const ch of this.chickenObjects) {
        if (!ch.alive) continue;
        ch.animTimer += dt * 3;

        // scatter from nearby dogs
        ch.scatterVx *= 0.9;
        ch.scatterVy *= 0.9;
        for (const dog of this.dogs) {
          if (!dog.alive || dog.fleeing) continue;
          const d = dist(ch.x, ch.y, dog.x, dog.y);
          if (d < 150 && d > 0) {
            const nx = (ch.x - dog.x) / d;
            const ny = (ch.y - dog.y) / d;
            const force = (150 - d) / 150 * 80;
            ch.scatterVx += nx * force * dt;
            ch.scatterVy += ny * force * dt;
          }
        }

        ch.x += ch.scatterVx;
        ch.y += ch.scatterVy;

        // keep in zone
        const zoneTop    = canvas.height * 0.53;
        const zoneBottom = canvas.height * 0.90;
        ch.x = clamp(ch.x, 30, canvas.width - 30);
        ch.y = clamp(ch.y, zoneTop, zoneBottom);
      }
    },

    // ── Dog management ──────────────────────────────────────────────────────
    spawnDog() {
      const fromLeft   = Math.random() < 0.5;
      const zoneTop    = canvas.height * 0.55;
      const zoneBottom = canvas.height * 0.85;
      const baseSpeed  = 55 + this.round * 15;

      // boss spawns as the last dog on boss rounds
      const isBoss = this.isBossRound && !this.bossSpawned &&
                     (this.dogsSpawned === this.dogsTotal - 1);
      if (isBoss) this.bossSpawned = true;

      this.dogs.push({
        x: fromLeft ? (isBoss ? -120 : -60) : (isBoss ? canvas.width + 120 : canvas.width + 60),
        y: isBoss ? canvas.height * 0.65 : rand(zoneTop, zoneBottom),
        alive: true,
        fleeing: false,
        fleeDir: fromLeft ? -1 : 1,
        speed: isBoss ? Math.max(35, baseSpeed * 0.55) : baseSpeed,
        facing: fromLeft ? 1 : -1,
        animTimer: rand(0, Math.PI * 2),
        eating: false,
        eatTimer: 0,
        eatTarget: null,
        hitFlash: 0,
        scale: isBoss ? 2.2 : rand(0.85, 1.15),
        isBoss: isBoss,
        hp: isBoss ? 5 : 1,
        maxHp: isBoss ? 5 : 1,
        staggerTimer: 0,   // brief stagger on hit before resuming
      });
      this.dogsSpawned++;
    },

    updateDogs(dt) {
      for (const dog of this.dogs) {
        if (!dog.alive) continue;
        dog.animTimer += dt * 4;
        dog.hitFlash = Math.max(0, dog.hitFlash - dt * 4);
        if (dog.staggerTimer > 0) { dog.staggerTimer -= dt; continue; }

        if (dog.eating) {
          dog.eatTimer -= dt;
          if (dog.eatTimer <= 0) {
            // finish eating
            if (dog.eatTarget && dog.eatTarget.alive) {
              dog.eatTarget.alive = false;
              this.chickens = this.chickenObjects.filter(c => c.alive).length;
              this.addFloatingText('Chicken lost!', dog.x, dog.y - 40, '#FF4444', 2, 28);
              this.addParticles(dog.eatTarget.x, dog.eatTarget.y, '#FFFFFF', 14, 100);
              if (this.chickens <= 0) {
                this.gameOver();
                return;
              }
            }
            dog.eating  = false;
            dog.fleeing = true;
            dog.fleeDir = dog.facing < 0 ? 1 : -1;
          }
          continue;
        }

        if (dog.fleeing) {
          dog.x += dog.fleeDir * dog.speed * 2 * dt;
          dog.facing = dog.fleeDir;
          continue;
        }

        // find nearest chicken and move toward it
        const target = this.findNearestChicken(dog);
        if (!target) {
          // no chickens left
          dog.fleeing = true;
          dog.fleeDir = dog.facing < 0 ? 1 : -1;
          continue;
        }

        const dx = target.x - dog.x;
        const dy = target.y - dog.y;
        const d  = Math.hypot(dx, dy);
        if (d > 0) {
          dog.facing = dx > 0 ? 1 : -1;
          dog.x += (dx / d) * dog.speed * dt;
          dog.y += (dy / d) * dog.speed * dt;
        }

        // reached chicken
        if (d < 32) {
          dog.eating   = true;
          dog.eatTimer = 1.5;
          dog.eatTarget = target;
        }
      }

      // remove off-screen fleeing dogs
      const before = this.dogs.length;
      this.dogs = this.dogs.filter(dog => {
        if (!dog.alive) return false;
        if (dog.fleeing && (dog.x < -150 || dog.x > canvas.width + 150)) {
          return false;
        }
        return true;
      });

      // round-end check
      if (this.state === 'playing' &&
          this.dogsSpawned >= this.dogsTotal &&
          this.dogs.length === 0) {
        this.endRound();
      }
    },

    findNearestChicken(dog) {
      let best = null;
      let bestDist = Infinity;
      for (const ch of this.chickenObjects) {
        if (!ch.alive || ch.eating) continue;
        const d = dist(dog.x, dog.y, ch.x, ch.y);
        if (d < bestDist) { bestDist = d; best = ch; }
      }
      return best;
    },

    // ── Projectiles ──────────────────────────────────────────────────────────
    getSlingOrigin() {
      return { x: canvas.width / 2, y: canvas.height * 0.865 };
    },

    getClampedPull(px, py) {
      const o = this.getSlingOrigin();
      const maxPull = Math.min(canvas.width, canvas.height) * 0.18;
      const dx = px - o.x;
      const dy = py - o.y;
      const d  = Math.hypot(dx, dy) || 0.001;
      const cd = Math.min(d, maxPull);
      return { x: o.x + (dx / d) * cd, y: o.y + (dy / d) * cd, d: cd, maxPull };
    },

    shootFromPull(px, py) {
      if (this.lastShot < this.cooldown) return;
      const o  = this.getSlingOrigin();
      const p  = this.getClampedPull(px, py);
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const power = p.d / p.maxPull;   // 0–1
      if (power < 0.08) return;        // ignore accidental micro-taps
      const speed = 900 + power * 900; // 900–1800 px/s
      const d = Math.hypot(dx, dy) || 0.001;
      this.projectiles.push({
        x: o.x, y: o.y,
        vx: (dx / d) * speed,
        vy: (dy / d) * speed,
        trail: [],
        alive: true,
      });
      this.lastShot = 0;
      this.addParticles(o.x, o.y, '#C8A07A', 6, 120);
    },

    updateProjectiles(dt) {
      for (const p of this.projectiles) {
        if (!p.alive) continue;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // off screen
        if (p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) {
          p.alive = false;
          continue;
        }

        // hit rooster
        const ro = this.rooster;
        if (ro.active && !ro.scared &&
            dist(p.x, p.y, ro.x, ro.y) < 30) {
          p.alive = false;
          ro.scared = true;
          ro.vx *= 3.5;
          const pts = 75 * this.round;
          this.score += pts;
          this.addFloatingText('¡EL GALLO! +' + pts, canvas.width / 2, canvas.height * 0.25, '#FF6600', 3.5, 46);
          this.addParticles(ro.x, ro.y, '#FF6600', 22, 220);
          // scare all non-boss dogs away
          for (const dog of this.dogs) {
            if (!dog.alive || dog.fleeing || dog.eating || dog.isBoss) continue;
            dog.fleeing  = true;
            dog.hitFlash = 0.6;
            dog.fleeDir  = dog.facing < 0 ? -1 : 1;
          }
        }

        // hit dogs
        for (const dog of this.dogs) {
          if (!dog.alive || dog.fleeing || dog.eating) continue;
          const hitR = dog.isBoss ? 52 : 28 * dog.scale;
          if (dist(p.x, p.y, dog.x, dog.y) < hitR) {
            p.alive = false;
            dog.hp--;
            dog.hitFlash    = 1;
            dog.staggerTimer = dog.isBoss ? 0.35 : 0;
            this.addParticles(p.x, p.y, dog.isBoss ? '#FF4400' : '#FFD700', dog.isBoss ? 16 : 10, 180);
            if (dog.hp <= 0) {
              dog.fleeing = true;
              dog.fleeDir = dog.facing < 0 ? 1 : -1;
              const pts = dog.isBoss ? 100 * this.round : 10 * this.round;
              this.score += pts;
              this.addFloatingText((dog.isBoss ? '¡JEFE HUYE! +' : '+') + pts,
                dog.x, dog.y - (dog.isBoss ? 80 : 40) * dog.scale,
                dog.isBoss ? '#FF2200' : '#FFD700', dog.isBoss ? 2.5 : 1.5,
                dog.isBoss ? 36 : 26);
            } else {
              // boss still alive — show remaining HP
              this.addFloatingText('HP: ' + dog.hp, dog.x, dog.y - 80, '#FF6600', 1.2, 28);
            }
            break;
          }
        }
      }
      this.projectiles = this.projectiles.filter(p => p.alive);
    },

    // ── Particles ────────────────────────────────────────────────────────────
    addParticles(x, y, color, count, speed) {
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const s     = rand(0.3, 1) * speed;
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * s,
          vy: Math.sin(angle) * s - rand(0, 80),
          life: 1,
          maxLife: rand(0.4, 1.0),
          color,
          r: rand(2, 6),
        });
      }
    },

    // ── Rooster ──────────────────────────────────────────────────────────────
    updateRooster(dt) {
      const r = this.rooster;
      if (!r.active) {
        if (this.round > 1) {
          r.spawnCountdown -= dt;
          if (r.spawnCountdown <= 0) {
            const fromLeft = Math.random() < 0.5;
            r.x   = fromLeft ? -60 : canvas.width + 60;
            r.y   = rand(canvas.height * 0.57, canvas.height * 0.80);
            r.vx  = fromLeft ? rand(55, 80) : -rand(55, 80);
            r.animTimer = 0;
            r.scared    = false;
            r.active    = true;
          }
        }
        return;
      }
      r.animTimer += dt * (r.scared ? 10 : 4);
      r.x += r.vx * dt;
      if (r.x < -120 || r.x > canvas.width + 120) {
        r.active = false;
        r.spawnCountdown = rand(18, 32);
      }
    },

    updateParticles(dt) {
      for (const p of this.particles) {
        p.x    += p.vx * dt;
        p.y    += p.vy * dt;
        p.vy   += 200 * dt; // gravity
        p.life -= dt / p.maxLife;
      }
      this.particles = this.particles.filter(p => p.life > 0);
    },

    // ── Floating text ─────────────────────────────────────────────────────────
    addFloatingText(text, x, y, color, duration, size) {
      this.floatingTexts.push({ text, x, y, color, duration, life: duration, size: size || 24 });
    },

    updateFloatingTexts(dt) {
      for (const t of this.floatingTexts) { t.life -= dt; t.y -= 30 * dt; }
      this.floatingTexts = this.floatingTexts.filter(t => t.life > 0);
    },

    // ── Draw ─────────────────────────────────────────────────────────────────
    draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawBackground();

      if (this.state === 'menu') {
        this.drawMenu();
        return;
      }

      this.drawChickens();
      this.drawDogs();
      if (this.rooster.active) this.drawRooster();
      this.drawProjectiles();
      this.drawParticles();
      this.drawSlingshot();
      this.drawFloatingTexts();
      this.drawHUD();

      if (this.state === 'round_end') this.drawRoundEnd();
      if (this.state === 'game_over') this.drawGameOver();
    },

    drawBackground() {
      const W = canvas.width;
      const H = canvas.height;
      if (bgLoaded) {
        ctx.drawImage(bgImage, 0, 0, W, H);
      } else {
        // sky gradient
        const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
        sky.addColorStop(0, '#87CEEB');
        sky.addColorStop(1, '#C9E8F5');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H * 0.6);

        // grass
        const grass = ctx.createLinearGradient(0, H * 0.6, 0, H);
        grass.addColorStop(0, '#5aad3e');
        grass.addColorStop(1, '#3d7a28');
        ctx.fillStyle = grass;
        ctx.fillRect(0, H * 0.6, W, H * 0.4);

        // ground line
        ctx.strokeStyle = '#4a9a30';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, H * 0.6);
        ctx.lineTo(W, H * 0.6);
        ctx.stroke();
      }
    },

    drawChickens() {
      for (const ch of this.chickenObjects) {
        if (!ch.alive) continue;
        this.drawChicken(ch.x, ch.y, 1, ch.animTimer);
      }
    },

    drawChicken(x, y, scale, animTimer) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      // legs
      const legSwing = Math.sin(animTimer) * 8;
      ctx.strokeStyle = '#E8A020';
      ctx.lineWidth = 3;
      // left leg
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.lineTo(-8 + legSwing, 24);
      ctx.lineTo(-12 + legSwing, 24);
      ctx.stroke();
      // right leg
      ctx.beginPath();
      ctx.moveTo(6, 10);
      ctx.lineTo(8 - legSwing, 24);
      ctx.lineTo(12 - legSwing, 24);
      ctx.stroke();

      // body
      ctx.fillStyle = '#F0F0F0';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#CCC';
      ctx.lineWidth = 1;
      ctx.stroke();

      // wing hint
      ctx.fillStyle = '#E0E0E0';
      ctx.beginPath();
      ctx.ellipse(4, 0, 10, 7, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // head
      ctx.fillStyle = '#F0F0F0';
      ctx.beginPath();
      ctx.arc(-14, -10, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#CCC';
      ctx.lineWidth = 1;
      ctx.stroke();

      // comb
      ctx.fillStyle = '#CC2222';
      ctx.beginPath();
      ctx.moveTo(-18, -17);
      ctx.lineTo(-16, -22);
      ctx.lineTo(-14, -18);
      ctx.lineTo(-12, -22);
      ctx.lineTo(-10, -17);
      ctx.closePath();
      ctx.fill();

      // beak
      ctx.fillStyle = '#E8A020';
      ctx.beginPath();
      ctx.moveTo(-22, -10);
      ctx.lineTo(-27, -9);
      ctx.lineTo(-22, -7);
      ctx.closePath();
      ctx.fill();

      // eye
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(-16, -12, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    drawDogs() {
      for (const dog of this.dogs) {
        if (!dog.alive) continue;
        this.drawDog(dog);
      }
    },

    drawDog(dog) {
      const bodyColor  = dog.isBoss ? '#2A1A0A' : '#A0643C';
      const bellyColor = dog.isBoss ? '#5A3018' : '#C8A07A';
      const legColor   = dog.isBoss ? '#1E1008' : '#8B5E3C';

      // ── boss HP bar (drawn in world space before transform) ─────────────────
      if (dog.isBoss && !dog.fleeing) {
        const bw = 80, bh = 10;
        const bx = dog.x - bw / 2, by = dog.y - 75;
        ctx.fillStyle = '#400';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#F22';
        ctx.fillRect(bx, by, bw * (dog.hp / dog.maxHp), bh);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('¡JEFE!', dog.x, by - 3);
      }

      ctx.save();
      ctx.translate(dog.x, dog.y);
      ctx.scale(-dog.facing * dog.scale, dog.scale);

      if (dog.hitFlash > 0) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(dog.hitFlash * 25);
      }

      const legSwing  = dog.fleeing
        ? Math.sin(dog.animTimer * 2.5) * 22  // frantic run
        : Math.sin(dog.animTimer) * 15;

      // tail — tucked between legs when fleeing, wagging when hunting
      ctx.save();
      ctx.translate(28, -10);
      if (dog.fleeing) {
        // tail between legs (rotated steeply downward)
        ctx.rotate(1.5);
        ctx.strokeStyle = legColor;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(5, 10, 3, 20);
        ctx.stroke();
      } else {
        const wagAngle = dog.eating ? 0.4 : Math.sin(dog.animTimer * 1.5) * 0.5;
        ctx.rotate(-wagAngle - 0.3);
        ctx.strokeStyle = legColor;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(12, -10, 10, -20);
        ctx.stroke();
      }
      ctx.restore();

      // back legs
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(18, 8);
      ctx.lineTo(20 - legSwing, 28);
      ctx.lineTo(16 - legSwing, 30);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 8);
      ctx.lineTo(14 + legSwing, 28);
      ctx.lineTo(10 + legSwing, 30);
      ctx.stroke();

      // body — crouched/lower when fleeing
      const bodyTilt = dog.fleeing ? 0.25 : 0;
      ctx.fillStyle = dog.hitFlash > 0 ? (dog.isBoss ? '#FF6600' : '#FFAA44') : bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, dog.fleeing ? 4 : 0, 30, dog.fleeing ? 12 : 16, bodyTilt, 0, Math.PI * 2);
      ctx.fill();

      // belly
      ctx.fillStyle = bellyColor;
      ctx.beginPath();
      ctx.ellipse(0, 6, 20, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // front legs
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-18, 8);
      ctx.lineTo(-20 + legSwing, 28);
      ctx.lineTo(-24 + legSwing, 30);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-12, 8);
      ctx.lineTo(-14 - legSwing, 28);
      ctx.lineTo(-18 - legSwing, 30);
      ctx.stroke();

      // neck — head lowered when fleeing
      const headY = dog.fleeing ? 2 : -8;
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(-24, headY + 2, 12, 9, dog.fleeing ? 0.3 : -0.4, 0, Math.PI * 2);
      ctx.fill();

      // head
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(-32, headY - 6, 14, 11, dog.fleeing ? 0.2 : -0.2, 0, Math.PI * 2);
      ctx.fill();

      // snout
      ctx.fillStyle = bellyColor;
      ctx.beginPath();
      ctx.ellipse(-42, headY - 4, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // nose
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.ellipse(-48, headY - 6, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // mouth
      if (dog.eating) {
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-43, headY - 2, 5, 0, Math.PI);
        ctx.stroke();
      }

      // eye — X eyes when fleeing, normal otherwise
      if (dog.fleeing) {
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = 2;
        const ex = -36, ey = headY - 10;
        ctx.beginPath();
        ctx.moveTo(ex - 4, ey - 4); ctx.lineTo(ex + 4, ey + 4);
        ctx.moveTo(ex + 4, ey - 4); ctx.lineTo(ex - 4, ey + 4);
        ctx.stroke();
      } else {
        ctx.fillStyle = dog.isBoss ? '#FF2200' : '#111';
        ctx.beginPath();
        ctx.arc(-36, headY - 10, dog.isBoss ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(-35, headY - 11, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // ear
      ctx.fillStyle = dog.isBoss ? '#1A0A00' : '#7A4A2C';
      ctx.beginPath();
      ctx.ellipse(-30, headY - 15, 7, 5, -0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // ── fleeing: stars spinning above head ─────────────────────────────────
      if (dog.fleeing) {
        const starCount = 3;
        const orbitR    = 18 * dog.scale;
        const baseY     = dog.y - 42 * dog.scale;
        for (let i = 0; i < starCount; i++) {
          const angle = dog.animTimer * 5 + (i / starCount) * Math.PI * 2;
          const sx = dog.x + Math.cos(angle) * orbitR;
          const sy = baseY + Math.sin(angle) * orbitR * 0.4;
          ctx.fillStyle = '#FFD700';
          ctx.font = `${Math.round(14 * dog.scale)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★', sx, sy);
        }
        ctx.textBaseline = 'alphabetic';
      }
    },

    drawRooster() {
      const r = this.rooster;
      ctx.save();
      ctx.translate(r.x, r.y);
      const dir = r.vx >= 0 ? 1 : -1;
      ctx.scale(dir * 1.35, 1.35);

      const leg = Math.sin(r.animTimer) * 10;

      // legs
      ctx.strokeStyle = '#C8860A';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(-6 + leg, 24); ctx.lineTo(-10 + leg, 24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, 12);  ctx.lineTo(6 - leg, 24); ctx.lineTo(10 - leg, 24);  ctx.stroke();

      // body – golden
      ctx.fillStyle = r.scared ? '#FF8800' : '#D4A020';
      ctx.beginPath();
      ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // iridescent tail feathers
      const tailColors = ['#2244AA', '#228844', '#9922AA'];
      for (let i = 0; i < 3; i++) {
        const a = -0.3 + i * 0.3;
        ctx.save();
        ctx.translate(16, -4);
        ctx.rotate(a + Math.sin(r.animTimer * 2 + i) * 0.08);
        ctx.fillStyle = tailColors[i];
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // wing
      ctx.fillStyle = '#B8900E';
      ctx.beginPath();
      ctx.ellipse(4, 2, 14, 8, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // neck
      ctx.fillStyle = '#D4A020';
      ctx.beginPath();
      ctx.ellipse(-16, -10, 9, 7, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // head
      ctx.fillStyle = '#D4A020';
      ctx.beginPath();
      ctx.arc(-22, -18, 9, 0, Math.PI * 2);
      ctx.fill();

      // big red comb
      ctx.fillStyle = '#CC1111';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-24 + i * 4, -25 - i % 2 * 3, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // wattle
      ctx.fillStyle = '#CC1111';
      ctx.beginPath();
      ctx.ellipse(-21, -12, 4, 6, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // beak
      ctx.fillStyle = '#E8A020';
      ctx.beginPath();
      ctx.moveTo(-30, -18); ctx.lineTo(-36, -17); ctx.lineTo(-30, -15);
      ctx.closePath(); ctx.fill();

      // eye
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-24, -20, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath(); ctx.arc(-23, -21, 1, 0, Math.PI * 2); ctx.fill();

      ctx.restore();

      // !! label so player knows to shoot it
      if (!r.scared) {
        ctx.save();
        ctx.font = `bold ${Math.max(11, canvas.width * 0.013)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText('¡DISPARA!', r.x, r.y - 44);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    },

    drawProjectiles() {
      for (const p of this.projectiles) {
        if (!p.alive) continue;
        // trail
        for (let i = 0; i < p.trail.length; i++) {
          const t = p.trail[i];
          const alpha = (i / p.trail.length) * 0.5;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#888';
          const r = 3 * (i / p.trail.length);
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // stone
        const grad = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, 7);
        grad.addColorStop(0, '#CCC');
        grad.addColorStop(1, '#555');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawParticles() {
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawFloatingTexts() {
      for (const t of this.floatingTexts) {
        const alpha = Math.min(1, t.life / t.duration * 2);
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle   = t.color;
        ctx.font        = `bold ${t.size}px Arial`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        // shadow
        ctx.shadowColor  = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur   = 4;
        ctx.fillText(t.text, t.x, t.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha  = 1;
      ctx.textBaseline = 'alphabetic';
    },

    drawSlingshot() {
      const W   = canvas.width;
      const H   = canvas.height;
      const cx  = W / 2;
      const o   = this.getSlingOrigin();       // fork centre (stone rest point)
      const tipSpread = W * 0.022;
      const tipRise   = H * 0.032;
      const tipLX = cx - tipSpread;
      const tipRX = cx + tipSpread;
      const tipY  = o.y - tipRise;
      const baseY = H + 40;

      // ── wood ───────────────────────────────────────────────────────────────
      ctx.strokeStyle = '#6B3A1F';
      ctx.lineWidth   = Math.max(8, W * 0.009);
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      ctx.beginPath();                    // handle
      ctx.moveTo(cx, baseY);
      ctx.lineTo(cx, o.y);
      ctx.stroke();

      ctx.beginPath();                    // left fork
      ctx.moveTo(cx, o.y);
      ctx.lineTo(tipLX, tipY);
      ctx.stroke();

      ctx.beginPath();                    // right fork
      ctx.moveTo(cx, o.y);
      ctx.lineTo(tipRX, tipY);
      ctx.stroke();

      // ── stone position ─────────────────────────────────────────────────────
      let sx, sy;
      if (this.sling.pulling) {
        const cp = this.getClampedPull(this.sling.pullX, this.sling.pullY);
        sx = cp.x;
        sy = cp.y;
      } else {
        sx = o.x;
        sy = o.y;
      }

      // ── trajectory preview (dots) ──────────────────────────────────────────
      if (this.sling.pulling && this.state === 'playing') {
        const cp    = this.getClampedPull(this.sling.pullX, this.sling.pullY);
        const power = cp.d / cp.maxPull;
        if (power >= 0.08) {
          const dx    = cp.x - o.x;
          const dy    = cp.y - o.y;
          const mag   = Math.hypot(dx, dy) || 0.001;
          const spd   = 900 + power * 900;
          let tx = o.x, ty = o.y;
          let tvx = (dx / mag) * spd;
          let tvy = (dy / mag) * spd;
          const simDt = 0.018;
          ctx.save();
          for (let i = 1; i <= 38; i++) {
            tx  += tvx * simDt;
            ty  += tvy * simDt;
            if (tx < 0 || tx > W || ty < 0 || ty > H) break;
            const alpha = 0.7 * (1 - i / 38);
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = '#FFF';
            ctx.beginPath();
            ctx.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // ── rubber bands ───────────────────────────────────────────────────────
      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth   = Math.max(2.5, W * 0.003);
      ctx.lineCap     = 'round';

      ctx.beginPath();
      ctx.moveTo(tipLX, tipY);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tipRX, tipY);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      // ── stone ──────────────────────────────────────────────────────────────
      const sr   = this.sling.pulling ? 9 : 7;
      const grad = ctx.createRadialGradient(sx - 2, sy - 2, 1, sx, sy, sr);
      grad.addColorStop(0, '#DDD');
      grad.addColorStop(1, '#555');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();

      // ── hint when idle ─────────────────────────────────────────────────────
      if (!this.sling.pulling && this.state === 'playing' && this.blinkVisible) {
        ctx.save();
        ctx.globalAlpha  = 0.6;
        ctx.fillStyle    = '#FFF';
        ctx.font         = `${Math.max(13, W * 0.016)}px Arial`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('drag to aim · release to fire', cx, H - 6);
        ctx.restore();
      }
    },

    drawCrosshair() {
      const ax = this.aimX;
      const ay = this.aimY;
      const elapsed = this.lastShot;
      const ready    = elapsed >= this.cooldown;
      const progress = Math.min(1, elapsed / this.cooldown);

      ctx.save();
      // cooldown arc
      if (!ready) {
        ctx.strokeStyle = 'rgba(255,60,60,0.85)';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(ax, ay, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
      }

      // crosshair lines
      ctx.strokeStyle = ready ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth   = 1.5;
      const sz = 12;
      ctx.beginPath();
      ctx.moveTo(ax - sz, ay); ctx.lineTo(ax + sz, ay);
      ctx.moveTo(ax, ay - sz); ctx.lineTo(ax, ay + sz);
      ctx.stroke();

      // circle
      ctx.beginPath();
      ctx.arc(ax, ay, 9, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    },

    drawHUD() {
      const W = canvas.width;
      const pad = 14;
      const barH = 44;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, barH);

      ctx.font = 'bold 22px Arial';
      ctx.textBaseline = 'middle';

      // left – chickens
      ctx.fillStyle = '#FFF';
      ctx.textAlign = 'left';
      ctx.fillText('🐔 ' + this.chickens, pad, barH / 2);

      // center – round
      ctx.textAlign = 'center';
      ctx.fillText('Round ' + this.round, W / 2, barH / 2);

      // right – score
      ctx.textAlign = 'right';
      ctx.fillText('Score: ' + this.score, W - pad, barH / 2);

      ctx.textBaseline = 'alphabetic';
      ctx.textAlign    = 'left';
    },

    drawMenu() {
      const W = canvas.width;
      const H = canvas.height;

      // light vignette — keep the farm photo visible
      const vign = ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, H*0.85);
      vign.addColorStop(0, 'rgba(0,0,0,0.15)');
      vign.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      // semi-transparent panel behind text so it's readable over any bg
      const panelH = H * 0.72;
      const panelW = Math.min(W * 0.88, 700);
      const panelX = (W - panelW) / 2;
      const panelY = H * 0.12;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelW, panelH, 18);
      ctx.fill();

      // Title — smaller so it fits on any screen
      const titleSize = Math.min(52, W * 0.075);
      ctx.font        = `bold ${titleSize}px Arial`;
      ctx.fillStyle   = '#FFD700';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur  = 10;
      ctx.fillText('¡Resortera Ranchera!', W / 2, H * 0.26);

      ctx.font      = `bold ${Math.min(26, W * 0.05)}px Arial`;
      ctx.fillStyle = '#FFF8DC';
      ctx.fillText('Defensa de la Granja', W / 2, H * 0.38);

      ctx.shadowBlur = 0;

      ctx.font      = `${Math.min(17, W * 0.038)}px Arial`;
      ctx.fillStyle = '#DDD';
      ctx.fillText('🐔 Protect your chickens from wild dogs!', W / 2, H * 0.50);
      ctx.fillText('🐓 Shoot the rooster to scare all dogs away!', W / 2, H * 0.58);
      ctx.fillText('Drag to aim · release to fire', W / 2, H * 0.66);

      if (this.highScore > 0) {
        ctx.font      = `bold ${Math.min(20, W * 0.04)}px Arial`;
        ctx.fillStyle = '#FFD700';
        ctx.fillText('Best: ' + this.highScore, W / 2, H * 0.74);
      }

      if (this.blinkVisible) {
        ctx.font      = `bold ${Math.min(26, W * 0.05)}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur  = 8;
        ctx.fillText('TAP TO PLAY', W / 2, H * 0.87);
        ctx.shadowBlur = 0;
      }

      ctx.textBaseline = 'alphabetic';
      ctx.textAlign    = 'left';
    },

    drawRoundEnd() {
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const alive = this.chickenObjects.filter(c => c.alive).length;

      ctx.font      = `bold ${Math.min(52, W * 0.1)}px Arial`;
      ctx.fillStyle = '#FFD700';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur  = 10;
      ctx.fillText('Round ' + this.round + ' Complete!', W / 2, H * 0.30);

      ctx.shadowBlur = 0;
      ctx.font       = `${Math.min(26, W * 0.055)}px Arial`;

      if (this.roundLostChickens > 0) {
        ctx.fillStyle = '#FF6666';
        ctx.fillText('Chickens lost: ' + this.roundLostChickens, W / 2, H * 0.42);
      } else {
        ctx.fillStyle = '#88FF88';
        ctx.fillText('No chickens lost! Perfect round!', W / 2, H * 0.42);
      }

      ctx.fillStyle = '#88FF66';
      ctx.fillText('2 new chicks born! 🐣', W / 2, H * 0.52);

      ctx.fillStyle = '#FFF';
      ctx.fillText('Alive chickens: ' + (alive + 2), W / 2, H * 0.61);

      ctx.fillStyle = '#FFD700';
      ctx.fillText('Score: ' + this.score, W / 2, H * 0.70);

      if (this.blinkVisible) {
        ctx.font      = `bold ${Math.min(28, W * 0.06)}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('Tap to continue', W / 2, H * 0.83);
      }

      ctx.textBaseline = 'alphabetic';
      ctx.textAlign    = 'left';
    },

    drawGameOver() {
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      ctx.font      = `bold ${Math.min(72, W * 0.14)}px Arial`;
      ctx.fillStyle = '#FF3333';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur  = 14;
      ctx.fillText('GAME OVER', W / 2, H * 0.26);

      ctx.shadowBlur = 0;
      ctx.font       = `${Math.min(26, W * 0.055)}px Arial`;
      ctx.fillStyle  = '#FFAAAA';
      ctx.fillText('All chickens were eaten!', W / 2, H * 0.38);

      ctx.fillStyle = '#FFF';
      ctx.fillText('Round reached: ' + this.round, W / 2, H * 0.48);
      ctx.fillText('Score: ' + this.score, W / 2, H * 0.57);

      ctx.fillStyle = '#FFD700';
      ctx.fillText('Best: ' + this.highScore, W / 2, H * 0.66);

      if (this.blinkVisible) {
        ctx.font      = `bold ${Math.min(28, W * 0.06)}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('Tap to Play Again', W / 2, H * 0.82);
      }

      ctx.textBaseline = 'alphabetic';
      ctx.textAlign    = 'left';
    },

    // ── Input ────────────────────────────────────────────────────────────────
    handleInput(x, y) {
      if (this.state === 'menu') {
        this.startGame();
        return;
      }
      if (this.state === 'round_end') {
        this.nextRound();
        return;
      }
      if (this.state === 'game_over') {
        this.startGame();
        return;
      }
      if (this.state === 'playing') {
        this.shoot(x, y);
      }
    },

    bindEvents() {
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        // Support both pointer and touch events
        const src = e.touches ? e.touches[0] || e.changedTouches[0] : e;
        return {
          x: (src.clientX - r.left) * (canvas.width  / r.width),
          y: (src.clientY - r.top)  * (canvas.height / r.height),
        };
      };

      const onDown = (e) => {
        e.preventDefault();
        const { x, y } = pos(e);
        if (this.state !== 'playing') {
          this.handleInput(x, y);
          return;
        }
        this.sling.pulling = true;
        this.sling.pullX   = x;
        this.sling.pullY   = y;
        this.aimX = x;
        this.aimY = y;
      };

      const onMove = (e) => {
        e.preventDefault();
        if (!this.sling.pulling) return;
        const { x, y } = pos(e);
        this.sling.pullX = x;
        this.sling.pullY = y;
        this.aimX = x;
        this.aimY = y;
      };

      const onUp = (e) => {
        e.preventDefault();
        if (!this.sling.pulling) return;
        this.sling.pulling = false;
        const { x, y } = pos(e);
        if (this.state === 'playing') this.shootFromPull(x, y);
      };

      canvas.addEventListener('pointerdown',   onDown, { passive: false });
      canvas.addEventListener('pointermove',   onMove, { passive: false });
      canvas.addEventListener('pointerup',     onUp,   { passive: false });
      canvas.addEventListener('pointercancel', ()  => { this.sling.pulling = false; });
    },
  };

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  Game.init();
})();
