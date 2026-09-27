const CW = (() => {
  'use strict';

  const MU_EARTH = 3.986004418e14;
  const R_EARTH  = 6.371e6;

  const MAX_SANE_DV = 500; // m/s

  function meanMotion(r_orbit, mu = MU_EARTH) {
    return Math.sqrt(mu / (r_orbit * r_orbit * r_orbit));
  }
  function meanMotionFromAltitude(altitude_m, mu = MU_EARTH) {
    return meanMotion(R_EARTH + altitude_m, mu);
  }

  function mag(v) { return Math.hypot(v.x, v.y, v.z); }

  function matVec(M, v) {
    return {
      x: M[0][0]*v.x + M[0][1]*v.y + M[0][2]*v.z,
      y: M[1][0]*v.x + M[1][1]*v.y + M[1][2]*v.z,
      z: M[2][0]*v.x + M[2][1]*v.y + M[2][2]*v.z
    };
  }
  function determinant3(M) {
    return M[0][0]*(M[1][1]*M[2][2] - M[1][2]*M[2][1])
         - M[0][1]*(M[1][0]*M[2][2] - M[1][2]*M[2][0])
         + M[0][2]*(M[1][0]*M[2][1] - M[1][1]*M[2][0]);
  }
  function invert3(M) {
    const det = determinant3(M);
    if (Math.abs(det) < 1e-20) return null;
    const id = 1/det;
    return [
      [(M[1][1]*M[2][2] - M[1][2]*M[2][1])*id,
       (M[0][2]*M[2][1] - M[0][1]*M[2][2])*id,
       (M[0][1]*M[1][2] - M[0][2]*M[1][1])*id],
      [(M[1][2]*M[2][0] - M[1][0]*M[2][2])*id,
       (M[0][0]*M[2][2] - M[0][2]*M[2][0])*id,
       (M[0][2]*M[1][0] - M[0][0]*M[1][2])*id],
      [(M[1][0]*M[2][1] - M[1][1]*M[2][0])*id,
       (M[0][1]*M[2][0] - M[0][0]*M[2][1])*id,
       (M[0][0]*M[1][1] - M[0][1]*M[1][0])*id]
    ];
  }

  function propagate(state, t, n) {
    const nt = n * t;
    const s = Math.sin(nt);
    const c = Math.cos(nt);
    const { x: x0, y: y0, z: z0, vx: vx0, vy: vy0, vz: vz0 } = state;

    const x  = (4 - 3*c) * x0 + (s/n) * vx0 + (2/n) * (1 - c) * vy0;
    const y  = 6 * (s - nt) * x0 + y0 + (2/n) * (c - 1) * vx0
             + (1/n) * (4*s - 3*nt) * vy0;
    const z  = c * z0 + (s/n) * vz0;

    const vx = 3*n*s * x0 + c * vx0 + 2*s * vy0;
    const vy = -6*n*(1 - c) * x0 - 2*s * vx0 + (4*c - 3) * vy0;
    const vz = -n*s * z0 + c * vz0;

    return { x, y, z, vx, vy, vz };
  }

  function transitionMatrix(t, n) {
    const nt = n * t;
    const s = Math.sin(nt);
    const c = Math.cos(nt);
    return {
      Φrr: [
        [4 - 3*c,     0,     0],
        [6*(s - nt),  1,     0],
        [0,           0,     c]
      ],
      Φrv: [
        [s/n,               (2/n)*(1 - c),         0],
        [(2/n)*(c - 1),     (1/n)*(4*s - 3*nt),    0],
        [0,                 0,                      s/n]
      ],
      Φvr: [
        [3*n*s,       0,    0],
        [-6*n*(1-c),  0,    0],
        [0,           0,   -n*s]
      ],
      Φvv: [
        [c,      2*s,      0],
        [-2*s,   4*c - 3,  0],
        [0,      0,        c]
      ]
    };
  }

  function impulseForLeg(r, v, rGoal, vGoal, dt, n) {
    const Φ = transitionMatrix(dt, n);
    const Φrr_r = matVec(Φ.Φrr, r);
    const rhs = {
      x: rGoal.x - Φrr_r.x,
      y: rGoal.y - Φrr_r.y,
      z: rGoal.z - Φrr_r.z
    };
    const invΦrv = invert3(Φ.Φrv);
    if (!invΦrv) return null;
    const vNew = matVec(invΦrv, rhs);
    const dv = {
      x: vNew.x - v.x,
      y: vNew.y - v.y,
      z: vNew.z - v.z
    };
    const dvMag = mag(dv);
    if (!isFinite(dvMag) || dvMag > MAX_SANE_DV) return null;
    return { vNew, dv, dvMag };
  }

  function solveRendezvous(r0, v0, T, N, n, target = null) {
    if (N < 2) return null;
    const targetR = target ? target.r : { x: 0, y: 0, z: 0 };
    const targetV = target ? target.v : { x: 0, y: 0, z: 0 };

    const dt = T / (N - 1);
    const impulses = [];
    let totalDv = 0;

    let r = { ...r0 };
    let v = { ...v0 };

    for (let i = 0; i < N - 1; i++) {
      const frac = (i + 1) / (N - 1);
      const rGoal = {
        x: targetR.x * frac,
        y: targetR.y * frac,
        z: targetR.z * frac
      };
      const vGoal = { x: 0, y: 0, z: 0 };

      const leg = impulseForLeg(r, v, rGoal, vGoal, dt, n);
      if (!leg) return null;

      impulses.push({
        t: i * dt,
        dv: leg.dv,
        magnitude: leg.dvMag
      });
      totalDv += leg.dvMag;

      v = leg.vNew;
      const state = { x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z };
      const next = propagate(state, dt, n);
      r = { x: next.x, y: next.y, z: next.z };
      v = { x: next.vx, y: next.vy, z: next.vz };
    }

    const dvFinal = {
      x: targetV.x - v.x,
      y: targetV.y - v.y,
      z: targetV.z - v.z
    };
    const dvFinalMag = mag(dvFinal);
    if (!isFinite(dvFinalMag) || dvFinalMag > MAX_SANE_DV) return null;
    impulses.push({ t: T, dv: dvFinal, magnitude: dvFinalMag });
    totalDv += dvFinalMag;

    return { impulses, totalDv, T, N };
  }

  function verifySequence(result, r0, v0, n, target = null) {
    const targetR = target ? target.r : { x: 0, y: 0, z: 0 };
    const targetV = target ? target.v : { x: 0, y: 0, z: 0 };
    let r = { ...r0 };
    let v = { ...v0 };
    let t = 0;
    for (const imp of result.impulses) {
      const dt = imp.t - t;
      if (dt > 1e-9) {
        const next = propagate({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z }, dt, n);
        r = { x: next.x, y: next.y, z: next.z };
        v = { x: next.vx, y: next.vy, z: next.vz };
        t = imp.t;
      }
      v.x += imp.dv.x;
      v.y += imp.dv.y;
      v.z += imp.dv.z;
    }
    if (t < result.T) {
      const next = propagate({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z }, result.T - t, n);
      r = { x: next.x, y: next.y, z: next.z };
      v = { x: next.vx, y: next.vy, z: next.vz };
    }
    return {
      rFinal: r,
      vFinal: v,
      posError: Math.hypot(r.x - targetR.x, r.y - targetR.y, r.z - targetR.z),
      velError: Math.hypot(v.x - targetV.x, v.y - targetV.y, v.z - targetV.z)
    };
  }

  function verifySequenceFiniteBurns(result, r0, v0, n, burnTime, target = null) {
    const targetR = target ? target.r : { x: 0, y: 0, z: 0 };
    const targetV = target ? target.v : { x: 0, y: 0, z: 0 };
    let r = { ...r0 };
    let v = { ...v0 };
    let t = 0;
    const SUB_STEPS = 200;

    for (const imp of result.impulses) {
      const dtToBurn = imp.t - t;
      if (dtToBurn > 1e-9) {
        const next = propagate({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z }, dtToBurn, n);
        r = { x: next.x, y: next.y, z: next.z };
        v = { x: next.vx, y: next.vy, z: next.vz };
        t = imp.t;
      }
      const accel = {
        x: imp.dv.x / burnTime,
        y: imp.dv.y / burnTime,
        z: imp.dv.z / burnTime
      };
      const subDt = burnTime / SUB_STEPS;
      for (let i = 0; i < SUB_STEPS; i++) {
        const next = propagate({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z }, subDt, n);
        r = { x: next.x, y: next.y, z: next.z };
        v = { x: next.vx, y: next.vy, z: next.vz };
        v.x += accel.x * subDt;
        v.y += accel.y * subDt;
        v.z += accel.z * subDt;
      }
      t += burnTime;
    }
    if (t < result.T) {
      const next = propagate({ x: r.x, y: r.y, z: r.z, vx: v.x, vy: v.y, vz: v.z }, result.T - t, n);
      r = { x: next.x, y: next.y, z: next.z };
      v = { x: next.vx, y: next.vy, z: next.vz };
    }
    return {
      rFinal: r,
      vFinal: v,
      posError: Math.hypot(r.x - targetR.x, r.y - targetR.y, r.z - targetR.z),
      velError: Math.hypot(v.x - targetV.x, v.y - targetV.y, v.z - targetV.z)
    };
  }

  function runTests() {
    const results = [];
    const log = (name, ok, detail) => {
      results.push({ name, ok, detail });
      const tag = ok ? '✓' : '✗';
      console.log(`${tag} ${name} — ${detail}`);
    };

    const ALT = 408000;
    const n = meanMotionFromAltitude(ALT);
    const period = 2 * Math.PI / n;

    console.log(`\n=== cw_solver.js v2 — pruebas ===`);
    console.log(`Órbita: alt=${ALT/1000} km, n=${n.toExponential(3)} rad/s, T=${(period/60).toFixed(1)} min\n`);

    {
      const s0 = { x: 1000, y: -500, z: 200, vx: 0.5, vy: -0.3, vz: 0.1 };
      const sT = propagate(s0, 1000, n);
      const sBack = propagate(sT, -1000, n);
      const err = Math.hypot(sBack.x - s0.x, sBack.y - s0.y, sBack.z - s0.z,
                             sBack.vx - s0.vx, sBack.vy - s0.vy, sBack.vz - s0.vz);
      log('Propagación reversible', err < 1e-6, `error=${err.toExponential(2)}`);
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const T = period / 2;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Multi-impulso radial (5 tramos)', false, 'solver devolvió null');
      } else {
        const ver = verifySequence(sol, r0, v0, n);
        log('Multi-impulso radial (5 tramos)',
            ver.posError < 1 && ver.velError < 0.01,
            `pos=${ver.posError.toExponential(2)} m, vel=${ver.velError.toExponential(2)} m/s, Δv=${sol.totalDv.toFixed(2)} m/s`);
      }
    }

    {
      const r0 = { x: -30000, y: 5000, z: 1000 };
      const v0 = { x: 0.5, y: -0.2, z: 0 };
      const T = period / 2;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Multi-impulso desplazado (5 tramos)', false, 'solver devolvió null');
      } else {
        const ver = verifySequence(sol, r0, v0, n);
        log('Multi-impulso desplazado (5 tramos)',
            ver.posError < 100 && ver.velError < 1,
            `pos=${ver.posError.toFixed(1)} m, vel=${ver.velError.toFixed(3)} m/s, Δv=${sol.totalDv.toFixed(2)} m/s`);
      }
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const T = period;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Multi-impulso con T=periodo', false, 'solver devolvió null');
      } else {
        const ver = verifySequence(sol, r0, v0, n);
        log('Multi-impulso con T=periodo',
            ver.posError < 100,
            `pos=${ver.posError.toFixed(1)} m, Δv=${sol.totalDv.toFixed(2)} m/s`);
      }
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const times = [period/8, period/4, period/3, period/2, 2*period/3];
      const dvs = [];
      let allOk = true;
      for (const T of times) {
        const sol = solveRendezvous(r0, v0, T, 5, n);
        if (!sol) { allOk = false; dvs.push('null'); continue; }
        dvs.push(sol.totalDv.toFixed(1));
        if (sol.totalDv <= 0 || sol.totalDv > 500) allOk = false;
      }
      log('Δv razonable en 5 tiempos', allOk, dvs.join(', ') + ' m/s');
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const T = period / 2;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Verificación instantánea (referencia)', false, 'solver devolvió null');
      } else {
        const ver = verifySequence(sol, r0, v0, n);
        log('Verificación instantánea (referencia)',
            ver.posError < 1,
            `pos=${ver.posError.toExponential(2)} m`);
      }
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const T = period / 2;
      const burnTime = 3;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Multi-impulso con quemas de 3 s', false, 'solver devolvió null');
      } else {
        const ver = verifySequenceFiniteBurns(sol, r0, v0, n, burnTime);
        log('Multi-impulso con quemas de 3 s',
            ver.posError < 100 && ver.velError < 1,
            `pos=${ver.posError.toFixed(1)} m, vel=${ver.velError.toFixed(3)} m/s ` +
            `(instantáneo ideal: pos=${verifySequence(sol, r0, v0, n).posError.toExponential(1)} m)`);
      }
    }

    {
      const r0 = { x: -10000, y: 0, z: 0 };
      const v0 = { x: 0, y: 0, z: 0 };
      const T = period / 2;
      const burnTime = 10;
      const sol = solveRendezvous(r0, v0, T, 5, n);
      if (!sol) {
        log('Multi-impulso con quemas de 10 s', false, 'solver devolvió null');
      } else {
        const ver = verifySequenceFiniteBurns(sol, r0, v0, n, burnTime);
        log('Multi-impulso con quemas de 10 s',
            ver.posError < 500,
            `pos=${ver.posError.toFixed(1)} m, vel=${ver.velError.toFixed(3)} m/s`);
      }
    }

    const failed = results.filter(r => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} pruebas OK ===\n`);
    return results;
  }

  const api = {
    MU_EARTH, R_EARTH,
    meanMotion, meanMotionFromAltitude,
    propagate, transitionMatrix,
    solveRendezvous,
    verifySequence, verifySequenceFiniteBurns,
    runTests
  };

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    setTimeout(() => api.runTests(), 0);
  }

  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CW;
