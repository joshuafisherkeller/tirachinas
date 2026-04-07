// ¡Resortera Ranchera!
// Single-file canvas game

(function () {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // ─── Resize ────────────────────────────────────────────────────────────────
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
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

    aimX: 0,
    aimY: 0,
    lastShot: -999,
    cooldown: 0.5,

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
      this.lastShot += dt; // using lastShot as elapsed since last fire
      this.updateProjectiles(dt);
      this.updateDogs(dt);
      this.updateChickens(dt);
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
      this.spawnChickens(10);
      this.startRound();
    },

    startRound() {
      this.state        = 'playing';
      this.dogs         = [];
      this.dogsSpawned  = 0;
      this.dogsTotal    = 3 + (this.round - 1) * 2;
      this.spawnTimer   = 1.5;
      this.prevChickenCount = this.chickenObjects.filter(c => c.alive).length;
      this.roundLostChickens = 0;
      this.addFloatingText('Round ' + this.round, canvas.width / 2, canvas.height * 0.3,
        '#FFD700', 2.5, 52);
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
      const fromLeft = Math.random() < 0.5;
      const zoneTop    = canvas.height * 0.55;
      const zoneBottom = canvas.height * 0.85;
      const baseSpeed  = 60 + (this.round - 1) * 12;
      this.dogs.push({
        x: fromLeft ? -60 : canvas.width + 60,
        y: rand(zoneTop, zoneBottom),
        alive: true,
        fleeing: false,
        fleeDir: fromLeft ? -1 : 1,
        speed: baseSpeed,
        facing: fromLeft ? 1 : -1,
        animTimer: rand(0, Math.PI * 2),
        eating: false,
        eatTimer: 0,
        eatTarget: null,
        hitFlash: 0,
        scale: rand(0.85, 1.15),
      });
      this.dogsSpawned++;
    },

    updateDogs(dt) {
      for (const dog of this.dogs) {
        if (!dog.alive) continue;
        dog.animTimer += dt * 4;
        dog.hitFlash = Math.max(0, dog.hitFlash - dt * 3);

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
            dog.fleeDir = dog.facing < 0 ? -1 : 1;
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
          dog.fleeDir = dog.facing < 0 ? -1 : 1;
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
    shoot(tx, ty) {
      const now = this._elapsed || 0;
      // use lastShot as time-since-last
      if (this.lastShot < this.cooldown) return;
      this.lastShot = 0;

      const sx = canvas.width  / 2;
      const sy = canvas.height * 0.92;
      const dx = tx - sx;
      const dy = ty - sy;
      const d  = Math.hypot(dx, dy) || 1;
      const speed = 1400;

      this.projectiles.push({
        x: sx, y: sy,
        vx: (dx / d) * speed,
        vy: (dy / d) * speed,
        trail: [],
        alive: true,
      });
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

        // hit dogs
        for (const dog of this.dogs) {
          if (!dog.alive || dog.fleeing || dog.eating) continue;
          if (dist(p.x, p.y, dog.x, dog.y) < 28 * dog.scale) {
            p.alive = false;
            dog.fleeing  = true;
            dog.hitFlash = 1;
            dog.fleeDir  = dog.facing < 0 ? -1 : 1;
            const pts = 10 * this.round;
            this.score += pts;
            this.addFloatingText('+' + pts, dog.x, dog.y - 40, '#FFD700', 1.5, 26);
            this.addParticles(p.x, p.y, '#FFD700', 10, 150);
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
      this.drawProjectiles();
      this.drawParticles();
      this.drawSlingshot();
      this.drawCrosshair();
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
      ctx.save();
      ctx.translate(dog.x, dog.y);
      ctx.scale(dog.facing * dog.scale, dog.scale);

      if (dog.hitFlash > 0) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(dog.hitFlash * 20);
      }

      const legSwing = Math.sin(dog.animTimer) * 15;

      // tail (wag)
      const wagAngle = dog.eating ? 0.4 : Math.sin(dog.animTimer * 1.5) * 0.5;
      ctx.save();
      ctx.translate(28, -10);
      ctx.rotate(-wagAngle - 0.3);
      ctx.strokeStyle = '#8B5E3C';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(12, -10, 10, -20);
      ctx.stroke();
      ctx.restore();

      // back legs
      ctx.strokeStyle = '#8B5E3C';
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

      // body
      ctx.fillStyle = dog.hitFlash > 0 ? '#FFAA44' : '#A0643C';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // belly
      ctx.fillStyle = '#C8A07A';
      ctx.beginPath();
      ctx.ellipse(0, 6, 20, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // front legs
      ctx.strokeStyle = '#8B5E3C';
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

      // neck
      ctx.fillStyle = '#A0643C';
      ctx.beginPath();
      ctx.ellipse(-24, -8, 12, 9, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // head
      ctx.fillStyle = '#A0643C';
      ctx.beginPath();
      ctx.ellipse(-32, -16, 14, 11, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // snout
      ctx.fillStyle = '#C8A07A';
      ctx.beginPath();
      ctx.ellipse(-42, -14, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // nose
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.ellipse(-48, -16, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // mouth (eating = open)
      if (dog.eating) {
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-43, -12, 5, 0, Math.PI);
        ctx.stroke();
      }

      // eye
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(-36, -20, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(-35, -21, 1, 0, Math.PI * 2);
      ctx.fill();

      // ear
      ctx.fillStyle = '#7A4A2C';
      ctx.beginPath();
      ctx.ellipse(-30, -25, 7, 5, -0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
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
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const baseY = H + 30; // handle below screen
      const forkH = H * 0.88;
      const tipLX = cx - 28;
      const tipRX = cx + 28;
      const tipY  = forkH - 22;

      // handle
      ctx.strokeStyle = '#6B3A1F';
      ctx.lineWidth   = 12;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, baseY);
      ctx.lineTo(cx, forkH);
      ctx.stroke();

      // fork left
      ctx.beginPath();
      ctx.moveTo(cx, forkH);
      ctx.lineTo(tipLX, tipY);
      ctx.stroke();

      // fork right
      ctx.beginPath();
      ctx.moveTo(cx, forkH);
      ctx.lineTo(tipRX, tipY);
      ctx.stroke();

      // rubber bands
      const ax = this.aimX;
      const ay = this.aimY;
      const bandColor = '#8B6914';
      ctx.strokeStyle = bandColor;
      ctx.lineWidth   = 3;

      ctx.beginPath();
      ctx.moveTo(tipLX, tipY);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tipRX, tipY);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      // stone at aim point
      const grad = ctx.createRadialGradient(ax - 2, ay - 2, 1, ax, ay, 8);
      grad.addColorStop(0, '#DDD');
      grad.addColorStop(1, '#555');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ax, ay, 8, 0, Math.PI * 2);
      ctx.fill();
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

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';

      // Title
      ctx.font      = `bold ${Math.min(80, W * 0.14)}px Arial`;
      ctx.fillStyle = '#FFD700';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur  = 12;
      ctx.fillText('¡Resortera Ranchera!', W / 2, H * 0.30);

      ctx.font      = `bold ${Math.min(34, W * 0.07)}px Arial`;
      ctx.fillStyle = '#FFF8DC';
      ctx.fillText('Defensa de la Granja', W / 2, H * 0.42);

      ctx.shadowBlur = 0;

      ctx.font      = `${Math.min(20, W * 0.045)}px Arial`;
      ctx.fillStyle = '#DDD';
      ctx.fillText('Protect your chickens from wild dogs!', W / 2, H * 0.54);
      ctx.fillText('Aim with mouse / touch · Click / tap to fire', W / 2, H * 0.61);

      if (this.highScore > 0) {
        ctx.font      = `bold ${Math.min(22, W * 0.05)}px Arial`;
        ctx.fillStyle = '#FFD700';
        ctx.fillText('Best: ' + this.highScore, W / 2, H * 0.70);
      }

      if (this.blinkVisible) {
        ctx.font      = `bold ${Math.min(28, W * 0.06)}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('TAP TO PLAY', W / 2, H * 0.82);
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
      // Mouse
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        this.aimX = e.clientX - r.left;
        this.aimY = e.clientY - r.top;
      });

      canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        this.handleInput(x, y);
      });

      // Touch
      canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        this.aimX = t.clientX - r.left;
        this.aimY = t.clientY - r.top;
      }, { passive: false });

      canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        this.aimX = t.clientX - r.left;
        this.aimY = t.clientY - r.top;
      }, { passive: false });

      canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        const x = t.clientX - r.left;
        const y = t.clientY - r.top;
        this.handleInput(x, y);
      }, { passive: false });
    },
  };

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  Game.init();
})();
