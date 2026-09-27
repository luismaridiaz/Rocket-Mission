const DockingAutopilot = (() => {
  'use strict';

  const DEFAULTS = {
    activationDist: 200,
    arrivalDist: 1,
    arrivalVel: 0.05,
    finalHorizon: 60,
    controlHz: 1,
    finalDeadbandPos: 0.5,
    finalDeadbandVel: 0.05,
    finalMinImpulse: 0.001,
    alignThreshold: 0.05,
    maxFrames: 20000,
    maxLogLines: 200,
    finalApproachEntryDist: 30,
    finalApproachWindow: 15,
    finalApproachK: 0.1,
    finalApproachMargin: 0.005,
    finalApproachKp: 0.3,
    finalApproachKd: 0.5
  };

  const V3 = {
    add:   (a,b) => ({ x:a.x+b.x, y:a.y+b.y, z:a.z+b.z }),
    sub:   (a,b) => ({ x:a.x-b.x, y:a.y-b.y, z:a.z-b.z }),
    scale: (a,k) => ({ x:a.x*k,   y:a.y*k,   z:a.z*k }),
    dot:   (a,b) => a.x*b.x + a.y*b.y + a.z*b.z,
    cross: (a,b) => ({
      x: a.y*b.z - a.z*b.y,
      y: a.z*b.x - a.x*b.z,
      z: a.x*b.y - a.y*b.x
    }),
    mag: (a) => Math.hypot(a.x, a.y, a.z),
    norm: (a) => {
      const m = V3.mag(a);
      return m > 1e-9 ? V3.scale(a, 1/m) : { x:0, y:0, z:0 };
    }
  };

  class LVLHFrame {
    constructor(issPos, issVel) {
      this.radial     = V3.norm(issPos);
      this.prograde   = V3.norm(issVel);
      this.crosstrack = V3.norm(V3.cross(this.radial, this.prograde));
    }
    toLVLH(v) {
      return {
        x: V3.dot(v, this.radial),
        y: V3.dot(v, this.prograde),
        z: V3.dot(v, this.crosstrack)
      };
    }
    toInertial(v) {
      return V3.add(
        V3.add(
          V3.scale(this.radial,     v.x),
          V3.scale(this.prograde,   v.y)
        ),
        V3.scale(this.crosstrack, v.z)
      );
    }
  }

  class Autopilot {
    constructor(app, opts = {}) {
      this.app = app;
      this.cfg = { ...DEFAULTS, ...opts };

      this.active = false;
      this.state = 'IDLE';

      this._plan = null;
      this._rNom0 = null;
      this._vNom0 = null;
      this._n_iss = null;

      this._pendingBurn = null;
      this._finalBurn = false;

      this._tCW = 0;
      this._lastDecisionT = -1e9;
      this._totalFrames = 0;

      this._log = [];
    }

    activate() {
      if (this.active) return false;
      const p = this.app && this.app.physics;
      if (!p) return false;
      if (!p._lastState || p._lastState.bodyName !== 'earth') {
        if (this.app.toast) this.app.toast.show('🛰️ CW: la nave no está cerca de la Tierra', 3000);
        return false;
      }
      this.active = true;
      this.state = 'PLAN';
      this._plan = null;
      this._rNom0 = null;
      this._vNom0 = null;
      this._n_iss = null;
      this._pendingBurn = null;
      this._finalBurn = false;
      this._tCW = 0;
      this._lastDecisionT = -1e9;
      this._totalFrames = 0;
      this._log = [];
      if (this.app.toast) this.app.toast.show('🛰️ Asistente CW activado', 3000);
      return true;
    }

    deactivate(msg) {
      if (!this.active) return;
      this.active = false;
      this.state = 'IDLE';
      this._pendingBurn = null;
      this._finalBurn = false;
      if (msg && this.app && this.app.toast) this.app.toast.show(msg, 4000);
    }

    isActive() { return this.active; }

    statusLabel() {
      const L = {
        IDLE: 'Inactivo', PLAN: 'Planificando', BURNING: 'Quemando',
        WAITING: 'Deriva + correcciones', FINAL_APPROACH: 'Aproximación final',
        DONE: 'Completado'
      };
      return L[this.state] || this.state;
    }

    step() {
      if (!this.active) return null;
      const p = this.app.physics;
      if (!p) return null;

      if (!p._lastState || p._lastState.bodyName !== 'earth') {
        this.deactivate('🛰️ CW desactivado (fuera de la Tierra)');
        return null;
      }

      const FIXED_DT = 1/60;
      this._tCW += FIXED_DT;
      this._totalFrames++;
      if (this._totalFrames > this.cfg.maxFrames) {
        this.deactivate('🛰️ CW: tope de frames alcanzado');
        return null;
      }

      switch (this.state) {
        case 'PLAN':    return this._stepPlan(p, FIXED_DT);
        case 'BURNING': return this._stepBurning(p, FIXED_DT);
        case 'WAITING': return this._stepWaiting(p, FIXED_DT);
        case 'FINAL_APPROACH': return this._stepFinalApproach(p, FIXED_DT);
        case 'DONE': {
          this.active = false;
          return { throttle: 0, pitch: 0, yaw: 0, roll: 0, timeScale: 1 };
        }
        default: return null;
      }
    }

    _stepPlan(p, dt) {
      const rel = this._computeRelativeLVLH(p);
      if (!rel) { this.deactivate(); return null; }

      const rISS = V3.mag(rel.iss.pos);
      this._n_iss = Math.sqrt(G * SOLAR_BODIES.earth.mass / (rISS*rISS*rISS));

      const plan = CW.solveRendezvous(
        rel.rRel, rel.vRel,
        this.cfg.finalHorizon, 2, this._n_iss
      );
      if (!plan) {
        this._log.push(`t=0 PLAN falló (solver null)`);
        this.deactivate('🛰️ CW: solver falló, modo cancelado');
        return null;
      }

      const dv0 = plan.impulses[0].dv;
      const dvF = plan.impulses[plan.impulses.length - 1].dv;
      this._plan = { dv0, dvF, Trendezvous: this.cfg.finalHorizon };

      this._rNom0 = { ...rel.rRel };
      this._vNom0 = {
        x: rel.vRel.x + dv0.x,
        y: rel.vRel.y + dv0.y,
        z: rel.vRel.z + dv0.z
      };

      const dv0Mag = V3.mag(dv0);
      const dvFMag = V3.mag(dvF);
      this._pushLog(`t=0 PLAN: dv0=${dv0Mag.toFixed(4)} dvF=${dvFMag.toFixed(4)}`);

      if (dv0Mag > this.cfg.finalMinImpulse) {
        this._pendingBurn = {
          dvRemaining: dv0Mag,
          dirLVLH: V3.norm(dv0)
        };
        this._finalBurn = false;
        this.state = 'BURNING';
        return this._stepBurning(p, dt);
      }
      this.state = 'WAITING';
      return this._stepWaiting(p, dt);
    }

    _stepBurning(p, dt) {
      const rel = this._computeRelativeLVLH(p);
      if (!rel) { this.deactivate(); return null; }

      const pending = this._pendingBurn;
      if (!pending) {
        this.state = 'WAITING';
        return this._stepWaiting(p, dt);
      }

      const dirInertial = V3.norm(rel.frame.toInertial(pending.dirLVLH));

      const heading = FRAME_ROTATION(RocketPhysics.rotateVec(0, 1, 0, p.pitch, p.yaw, p.roll));
      const dot = V3.dot(heading, dirInertial);
      const alignErr = Math.acos(Math.max(-1, Math.min(1, dot)));
      const aligned = alignErr < this.cfg.alignThreshold;

      const steer = p.autopilotSteer(dirInertial);

      if (!aligned) {
        return { throttle: 0, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
      }

      // CORREGIDO: p.stack.totalMass() no existe -- la masa real es p.dryMass+p.fuelMass
      const mass = p.dryMass + p.fuelMass;
      const thrustMax = p.maxThrust;
      const maxDvThisFrame = thrustMax * dt / mass;
      const dvToDeliver = Math.min(pending.dvRemaining, maxDvThisFrame);
      const throttle = maxDvThisFrame > 0 ? dvToDeliver / maxDvThisFrame : 0;

      pending.dvRemaining -= dvToDeliver;

      if (pending.dvRemaining <= 1e-5) {
        this._pendingBurn = null;
        if (this._finalBurn) {
          this._finalBurn = false;
          this._pushLog(`t=${this._tCW.toFixed(2)} BURN FINAL completo`);
          this.state = 'DONE';
          this.deactivate('🛰️ Asistente CW completado');
          return { throttle, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
        }
        this.state = 'WAITING';
      }

      return { throttle, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
    }

    _stepWaiting(p, dt) {
      const rel = this._computeRelativeLVLH(p);
      if (!rel) { this.deactivate(); return null; }

      const dist = V3.mag(rel.rRel);
      const speed = V3.mag(rel.vRel);

      // Transicion a FINAL_APPROACH: cuando estamos cerca o queda poco tiempo.
      // A partir de aqui el CW pierde utilidad y aplicamos el perfil de velocidad.
      const tRestanteEntry = this._plan.Trendezvous - this._tCW;
      if (dist < this.cfg.finalApproachEntryDist || tRestanteEntry < this.cfg.finalApproachWindow) {
        this.state = 'FINAL_APPROACH';
        return this._stepFinalApproach(p, dt);
      }

      // Alineacion anticipada: mientras se espera (sin quemar), mantener la
      // nave apuntando hacia donde apuntara el proximo burn (-v_real). Los
      // returns "throttle:0" durante WAITING NO deben devolver pitch:0/yaw:0/
      // roll:0 (eso es "no mandar rotacion", la nave mantiene la actitud
      // vieja) -- deben devolver esta alineacion, o el burn final llega con
      // la nave desorientada y tarda varios segundos en girar mientras deriva.
      const vMag = V3.mag(rel.vRel);
      let alignPitch = 0, alignYaw = 0, alignRoll = 0;
      if (vMag > 0.05) {
        const anticipatedDir = V3.scale(rel.vRel, -1 / vMag);
        const dirInertial = V3.norm(rel.frame.toInertial(anticipatedDir));
        const steer = p.autopilotSteer(dirInertial);
        alignPitch = steer.pitch;
        alignYaw = steer.yaw;
        alignRoll = steer.roll;
      }
      const esperando = { throttle: 0, pitch: alignPitch, yaw: alignYaw, roll: alignRoll, timeScale: 1 };

      if (dist < this.cfg.arrivalDist && speed < this.cfg.arrivalVel) {
        this._pushLog(`t=${this._tCW.toFixed(2)} LLEGADA prematura`);
        this.state = 'DONE';
        this.deactivate('🛰️ Asistente CW completado');
        return { throttle: 0, pitch: 0, yaw: 0, roll: 0, timeScale: 1 };
      }

      if (this._tCW >= this._plan.Trendezvous) {
        // CAMBIO B: anular la velocidad relativa REAL (rel.vRel, ya calculada
        // al principio de esta funcion), no this._plan.dvF. El dvF del plan
        // asume que la nave siguio el nominal; como no lo ha hecho (dvErr
        // acumulado durante el trayecto), aplicar dvF_plan deja residual.
        const dvFReal = { x: -rel.vRel.x, y: -rel.vRel.y, z: -rel.vRel.z };
        const dvFMag = V3.mag(dvFReal);
        if (dvFMag > 1e-4) {
          this._pendingBurn = {
            dvRemaining: dvFMag,
            dirLVLH: V3.norm(dvFReal)
          };
          this._finalBurn = true;
          this._pushLog(`t=${this._tCW.toFixed(2)} BURN FINAL encolado: |v|=${dvFMag.toFixed(4)}`);
          this.state = 'BURNING';
          return this._stepBurning(p, dt);
        }
        this.state = 'DONE';
        this.deactivate('🛰️ Asistente CW completado');
        return { throttle: 0, pitch: 0, yaw: 0, roll: 0, timeScale: 1 };
      }

      if (this._tCW - this._lastDecisionT < 1 / this.cfg.controlHz) {
        return esperando;
      }
      this._lastDecisionT = this._tCW;

      const nominal = this._nominalStateAt(this._tCW);
      const dr = V3.sub(rel.rRel, nominal.r);
      const dvErr = V3.sub(rel.vRel, nominal.v);
      const drMag = V3.mag(dr);
      const dvErrMag = V3.mag(dvErr);

      if (drMag < this.cfg.finalDeadbandPos && dvErrMag < this.cfg.finalDeadbandVel) {
        return esperando;
      }

      const tRestante = this._plan.Trendezvous - this._tCW;
      if (tRestante <= 0.1) {
        return esperando;
      }

      const corr = CW.solveRendezvous(dr, dvErr, tRestante, 2, this._n_iss);
      if (!corr) return esperando;

      const dvCorr = corr.impulses[0].dv;
      const dvCorrMag = V3.mag(dvCorr);
      if (dvCorrMag < this.cfg.finalMinImpulse) {
        return esperando;
      }

      this._pushLog(`t=${this._tCW.toFixed(2)} CORR: dr=${drMag.toFixed(3)} dvErr=${dvErrMag.toFixed(3)} dv=${dvCorrMag.toFixed(3)}`);
      this._pendingBurn = {
        dvRemaining: dvCorrMag,
        dirLVLH: V3.norm(dvCorr)
      };
      this._finalBurn = false;
      this.state = 'BURNING';
      return this._stepBurning(p, dt);
    }

    _stepFinalApproach(p, dt) {
      const rel = this._computeRelativeLVLH(p);
      if (!rel) { this.deactivate(); return null; }

      const dist = V3.mag(rel.rRel);
      const speed = V3.mag(rel.vRel);

      if (dist < this.cfg.arrivalDist && speed < this.cfg.arrivalVel) {
        this._pushLog(`t=${this._tCW.toFixed(2)} LLEGADA FINAL: dist=${dist.toFixed(4)} speed=${speed.toFixed(4)}`);
        this.state = 'DONE';
        this.deactivate('🛰️ Asistente CW completado');
        return { throttle: 0, pitch: 0, yaw: 0, roll: 0, timeScale: 1 };
      }

      const heading = FRAME_ROTATION(RocketPhysics.rotateVec(0, 1, 0, p.pitch, p.yaw, p.roll));
      const mass = p.dryMass + p.fuelMass;
      const maxDvThisFrame = p.maxThrust * dt / mass;

      // ---- Regimen 1: perfil de velocidad ----
      const vProfile = this.cfg.finalApproachK * dist;
      if (speed > vProfile + this.cfg.finalApproachMargin) {
        const retroDir = V3.scale(rel.vRel, -1 / speed);
        const retroInertial = V3.norm(rel.frame.toInertial(retroDir));
        const steer = p.autopilotSteer(retroInertial);
        const dot = V3.dot(heading, retroInertial);
        const alignErr = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (alignErr > this.cfg.alignThreshold) {
          return { throttle: 0, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
        }
        const dvNeeded = speed - vProfile;
        const throttle = maxDvThisFrame > 0 ? Math.min(1, dvNeeded / maxDvThisFrame) : 0;
        this._pushLog(`t=${this._tCW.toFixed(2)} FINAL-PROF: dist=${dist.toFixed(3)} spd=${speed.toFixed(3)} vProf=${vProfile.toFixed(3)} thr=${throttle.toFixed(3)}`);
        return { throttle, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
      }

      // ---- Regimen 2: PD continuo sobre el eje radial ----
      // Direccion fija: -r_hat (radial hacia dentro). NUNCA cambia de sentido.
      // Magnitud: ACELERACION (m/s^2), no dv. Se aplica en cada fotograma.
      const distSafe = Math.max(dist, 0.05);
      const radialOut = V3.scale(rel.rRel, 1 / distSafe);
      const radialInward = V3.scale(radialOut, -1);
      const radialInertial = V3.norm(rel.frame.toInertial(radialInward));
      const steer = p.autopilotSteer(radialInertial);

      const vRadial = V3.dot(rel.vRel, radialOut);

      const aNeeded = this.cfg.finalApproachKp * dist
                    + this.cfg.finalApproachKd * vRadial;

      const dot = V3.dot(heading, radialInertial);
      const alignErr = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (alignErr > this.cfg.alignThreshold) {
        return { throttle: 0, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
      }

      if (aNeeded <= 0) {
        return { throttle: 0, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
      }

      const aMax = p.maxThrust / mass;
      const throttle = aMax > 0 ? Math.min(1, aNeeded / aMax) : 0;

      this._pushLog(`t=${this._tCW.toFixed(2)} FINAL-RAD: dist=${dist.toFixed(3)} vRad=${vRadial.toFixed(4)} a=${aNeeded.toFixed(4)} thr=${throttle.toFixed(4)}`);
      return { throttle, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll, timeScale: 1 };
    }

    _getISSState(p) {
      const t = p.time;
      const earthPos = positionOf('earth', t);
      const issHelio = orbitalObjectPosition(ISS, t);
      const issPosGeo = {
        x: issHelio.x - earthPos.x,
        y: issHelio.y - earthPos.y,
        z: issHelio.z - earthPos.z
      };
      const issVelGeo = orbitalObjectVelocity(ISS, t);
      return { pos: issPosGeo, vel: issVelGeo };
    }

    _getShipState(p) {
      return {
        pos: { x: p.x, y: p.y, z: p.z },
        vel: { x: p.u, y: p.v, z: p.w },
        mass: p.dryMass + p.fuelMass
      };
    }

    _computeRelativeLVLH(p) {
      const iss = this._getISSState(p);
      const ship = this._getShipState(p);
      const frame = new LVLHFrame(iss.pos, iss.vel);
      const rRelInertial = V3.sub(ship.pos, iss.pos);
      const vRelInertial = V3.sub(ship.vel, iss.vel);
      return {
        frame,
        rRel: frame.toLVLH(rRelInertial),
        vRel: frame.toLVLH(vRelInertial),
        ship, iss
      };
    }

    _nominalStateAt(t) {
      if (!this._plan) return { r: {x:0,y:0,z:0}, v: {x:0,y:0,z:0} };
      const prop = CW.propagate(
        {
          x: this._rNom0.x, y: this._rNom0.y, z: this._rNom0.z,
          vx: this._vNom0.x, vy: this._vNom0.y, vz: this._vNom0.z
        },
        t, this._n_iss
      );
      return {
        r: { x: prop.x, y: prop.y, z: prop.z },
        v: { x: prop.vx, y: prop.vy, z: prop.vz }
      };
    }

    _pushLog(line) {
      this._log.push(line);
      if (this._log.length > this.cfg.maxLogLines) this._log.shift();
    }
  }

  return { Autopilot, LVLHFrame, V3 };
})();

if (typeof window !== 'undefined') window.DockingAutopilot = DockingAutopilot;
if (typeof module !== 'undefined' && module.exports) module.exports = DockingAutopilot;
