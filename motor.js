
(function checkDeps(){
  const missing = [];
  if (typeof THREE === 'undefined') missing.push('three.js core');
  else {
    ['OrbitControls','EffectComposer','RenderPass','ShaderPass','UnrealBloomPass','CopyShader']
      .forEach(k => { if (typeof THREE[k] === 'undefined') missing.push('THREE.'+k); });
  }
  if (missing.length) {
    const el = document.getElementById('statusMsg');
    el.style.display = 'block';
    el.textContent = '⚠️ Faltan librerías: ' + missing.join(', ');
    throw new Error('Dependencias de Three.js incompletas: ' + missing.join(', '));
  }
})();

/* ---------- FÍSICA ---------- */
/* ---------- SISTEMA SOLAR: datos reales y mecanica orbital ---------- */
const AU = 1.495978707e11;
const G = 6.67430e-11;
// Fecha de inicio de la mision: "hoy" (misma fecha de referencia usada para calcular la posicion de Halley,
// asi todo el calendario del juego es coherente entre si).
const MISSION_START_MS = new Date('2026-09-07T00:00:00Z').getTime();
function missionDate(simSeconds){ return new Date(MISSION_START_MS + simSeconds*1000); }
function formatMissionDate(d){
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return String(d.getUTCDate()).padStart(2,'0')+' '+meses[d.getUTCMonth()]+' '+d.getUTCFullYear();
}
function formatElapsed(s){
  if (s<60) return s.toFixed(0)+'s';
  if (s<3600) return (s/60).toFixed(1)+'min';
  if (s<86400) return (s/3600).toFixed(1)+'h';
  if (s<86400*365.25) return (s/86400).toFixed(1)+'d';
  return (s/(86400*365.25)).toFixed(2)+'años';
}
// Formato unico de distancia, usado en TODOS los lectores (telemetria, HUDs, mini-vistas) para
// que la unidad nunca se duplique (bug real encontrado: "400958095.2kmm") y los numeros grandes
// (interplanetarios) sean legibles en vez de una pared de digitos.
function formatDistance(m){
  const absM=Math.abs(m);
  if (absM<1000) return m.toFixed(0)+' m';
  if (absM<1e7) return (m/1000).toFixed(1)+' km';
  if (absM<1.5e11) return Math.round(m/1000).toLocaleString('es-ES')+' km';
  return (m/AU).toFixed(3)+' UA';
}
const DAY = 86400;

/* ---------- ROTACION REAL DE LA TIERRA Y COORDENADAS LAT/LON ---------- */
const EARTH_SIDEREAL_DAY = 86164.1; // segundos (dia sideral real, no las 24h del dia solar)
const LAUNCH_SITE = (typeof window!=='undefined' && window.CUSTOM_LAUNCH_SITE) || { name:'Kourou (Guayana Francesa, ESA)', latDeg:5.2, lonDeg:-52.8 };
// Elegido en vez de Cabo Cañaveral (28.5N, el real del Apolo 11) porque esa latitud es MAS
// inclinada que el plano orbital de la Luna en nuestro modelo (5.145 grados) -- lanzar alli
// exigiria un cambio de plano que no modelamos. Kourou (5.2N, base real de la ESA) coincide
// casi exacto con el plano lunar, y es la misma razon fisica por la que en la realidad se
// lanza cerca del ecuador cuando el destino lo permite (por eso Cabo Cañaveral tampoco esta
// en un polo: la latitud de lanzamiento fija que inclinaciones orbitales se pueden alcanzar).
function latLonToXYZ(latDeg, lonDeg, r){
  const lat=latDeg*Math.PI/180, lon=lonDeg*Math.PI/180;
  return { x:r*Math.cos(lat)*Math.cos(lon), y:r*Math.sin(lat), z:r*Math.cos(lat)*Math.sin(lon) };
}
function eastDirAt(lonDeg){
  const lon=lonDeg*Math.PI/180;
  return { x:-Math.sin(lon), y:0, z:Math.cos(lon) };
}
function earthRotationBoost(latDeg, R_earth){
  const lat=latDeg*Math.PI/180;
  return (2*Math.PI*R_earth*Math.cos(lat))/EARTH_SIDEREAL_DAY;
}

// ---- Rotacion de marco de referencia: 'arriba' (cabeceo 0) deja de ser siempre el eje Y global.
// Al lanzar desde un punto que no es el 'polo' de nuestro sistema de coordenadas, la vertical
// local de verdad es otra direccion -- esta rotacion fija (calculada una vez) hace que 'cabeceo 0'
// siga significando 'arriba de verdad' en el sitio de lanzamiento real, sin tocar como se pilotea.
function cross3(a,b){ return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
function dot3(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function norm3(v){ const m=Math.sqrt(dot3(v,v))||1; return {x:v.x/m,y:v.y/m,z:v.z/m}; }
function rotateAroundAxis(v, axis, angle){
  const cosA=Math.cos(angle), sinA=Math.sin(angle);
  const d=dot3(axis,v), c=cross3(axis,v);
  return { x:v.x*cosA+c.x*sinA+axis.x*d*(1-cosA), y:v.y*cosA+c.y*sinA+axis.y*d*(1-cosA), z:v.z*cosA+c.z*sinA+axis.z*d*(1-cosA) };
}
function makeRotation(from, to){
  from=norm3(from); to=norm3(to);
  const d=dot3(from,to);
  if (d>0.999999) return v=>v;
  if (d<-0.999999){
    const axis = Math.abs(from.x)<0.9 ? norm3(cross3(from,{x:1,y:0,z:0})) : norm3(cross3(from,{x:0,y:1,z:0}));
    return v=>rotateAroundAxis(v,axis,Math.PI);
  }
  const axis=norm3(cross3(from,to));
  const angle=Math.acos(Math.max(-1,Math.min(1,d)));
  return v=>rotateAroundAxis(v,axis,angle);
}
const LAUNCH_UP = norm3(latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, 1));
const FRAME_ROTATION = makeRotation({x:0,y:1,z:0}, LAUNCH_UP);
const FRAME_ROTATION_INV = makeRotation(LAUNCH_UP, {x:0,y:1,z:0});
// Yaw que apunta al ESTE real una vez tumbada la nave (el giro gravitatorio real: lanzar hacia
// el este es lo que da la inclinacion orbital mas baja alcanzable desde una latitud dada).
const EAST_LOCAL = FRAME_ROTATION_INV(eastDirAt(LAUNCH_SITE.lonDeg));
const LAUNCH_YAW_EAST = Math.atan2(EAST_LOCAL.x, EAST_LOCAL.z);

const SOLAR_BODIES = {
  sun:     { mass:1.989e30, radius:6.96e8, parent:null, color:0xffcc66 },
  earth:   { mass:5.972e24, radius:6.371e6, parent:'sun', a:1.000*AU, period:365.25*DAY, phase0:6.01299, incl:0 },
  moon:    { mass:7.342e22, radius:1.7374e6, parent:'earth', a:3.844e8, period:27.321661*DAY, phase0:0, incl:0.08980 },
  mars:    { mass:6.417e23, radius:3.3895e6, parent:'sun', a:1.524*AU, period:686.98*DAY, phase0:1.28055, incl:0.03228, color:0xc1440e },
  jupiter: { mass:1.898e27, radius:6.9911e7, parent:'sun', a:5.203*AU, period:4332.59*DAY, phase0:2.25632, incl:0.02277, color:0xd8ae6f },
  io:      { mass:8.93e22,  radius:1.8216e6, parent:'jupiter', a:4.217e8, period:1.769*DAY, phase0:0, incl:0, color:0xe8d060 },
  europa:  { mass:4.8e22,   radius:1.5608e6, parent:'jupiter', a:6.709e8, period:3.551*DAY, phase0:1.1, incl:0, color:0xd9c9a8 },
  ganymede:{ mass:1.4819e23,radius:2.6341e6, parent:'jupiter', a:1.0704e9, period:7.155*DAY, phase0:2.4, incl:0, color:0x9c8f7a },
  callisto:{ mass:1.0759e23,radius:2.4103e6, parent:'jupiter', a:1.8827e9, period:16.69*DAY, phase0:3.6, incl:0, color:0x7a6f60 },
  saturn:  { mass:5.683e26, radius:5.8232e7, parent:'sun', a:9.537*AU, period:10759.22*DAY, phase0:0.17604, incl:0.04339, color:0xead6a8 },
  titan:   { mass:1.3452e23,radius:2.5747e6, parent:'saturn', a:1.2218e9, period:15.945*DAY, phase0:0, incl:0, color:0xd6a85a },
  uranus:  { mass:8.681e25, radius:2.5362e7, parent:'sun', a:19.191*AU, period:30688.5*DAY, phase0:1.08882, incl:0.01349, color:0x9fd6e0 },
  neptune: { mass:1.024e26, radius:2.4622e7, parent:'sun', a:30.069*AU, period:60195*DAY, phase0:0.04382, incl:0.03089, color:0x4166f5 },
  pluto:   { mass:1.303e22, radius:1.1883e6, parent:'sun', a:39.482*AU, period:90560*DAY, phase0:5.31226, incl:0.29950, color:0xcbb69d }
};
const SOLAR_BODY_NAMES = Object.keys(SOLAR_BODIES).filter(n=>n!=='sun');

function soiOf(name){
  const b=SOLAR_BODIES[name];
  if (!b.parent) return 1e15;
  const parent=SOLAR_BODIES[b.parent];
  return b.a*Math.pow(b.mass/parent.mass,0.4);
}
function positionOf(name,t){
  const b=SOLAR_BODIES[name];
  if (!b.parent) return {x:0,y:0,z:0};
  const pp=positionOf(b.parent,t);
  const angle=b.phase0+(2*Math.PI/b.period)*t;
  // orbita inclinada: se calcula en el plano y luego se inclina alrededor del eje x
  // (simplificacion: se ignora la longitud del nodo ascendente real, el eje de inclinacion
  // se fija en x para todos los cuerpos - suficiente para romper la coplanaridad total)
  const xp=b.a*Math.cos(angle), zp=b.a*Math.sin(angle);
  const incl=b.incl||0;
  return {x:pp.x+xp, y:pp.y+zp*Math.sin(incl), z:pp.z+zp*Math.cos(incl)};
}

/* ---------- ACOPLAMIENTO: sistema generico de objetivos ---------- */
// Cualquier escenario futuro (estacion, rescate) solo necesita añadir una entrada aqui:
// parent (que cuerpo orbita), altitude (altura sobre la superficie), y phase0 (angulo de partida).
// El resto (periodo, velocidad orbital, deteccion de acoplamiento) es generico.
const DOCKING_TARGETS = [
  { id:'plataforma_leo', name:'Plataforma Orbital (demo)', parent:'earth', altitude:400000, phase0:1.0 }
];
const DOCK_MAX_DIST = 15; // metros
const DOCK_MAX_SPEED = 0.3; // m/s
function dockingTargetState(target, t){
  const parent = SOLAR_BODIES[target.parent];
  const r = parent.radius + target.altitude;
  const period = 2*Math.PI*Math.sqrt(Math.pow(r,3)/(6.67430e-11*parent.mass));
  const angVel = 2*Math.PI/period;
  const angle = target.phase0 + angVel*t;
  return {
    pos:{x:r*Math.cos(angle), y:0, z:r*Math.sin(angle)},
    vel:{x:-r*angVel*Math.sin(angle), y:0, z:r*angVel*Math.cos(angle)},
    r, period
  };
}

// Cometa Halley: elementos orbitales reales, Kepler eliptico (e=0.967, no admite aproximacion circular)
const HALLEY = {
  a: 17.834*AU, e:0.96658, period:75.32*365.25*DAY,
  daysSincePerihelion: 14820, // dias desde el perihelio real del 9-feb-1986 hasta la fecha de referencia (7-sep-2026)
  inclinationTilt: 2.83
};
function solveKepler(M,e){
  let E=M;
  for (let i=0;i<50;i++){
    const dE=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    E-=dE;
    if (Math.abs(dE)<1e-10) break;
  }
  return E;
}
function halleyPosition(t){
  const n=2*Math.PI/HALLEY.period;
  const M0=n*(HALLEY.daysSincePerihelion*DAY);
  const M=((M0+n*t)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
  const E=solveKepler(M,HALLEY.e);
  const r=HALLEY.a*(1-HALLEY.e*Math.cos(E));
  const nu=2*Math.atan2(Math.sqrt(1+HALLEY.e)*Math.sin(E/2),Math.sqrt(1-HALLEY.e)*Math.cos(E/2));
  const xOrb=r*Math.cos(nu), zOrb=r*Math.sin(nu);
  return {x:xOrb, y:zOrb*Math.sin(HALLEY.inclinationTilt), z:zOrb*Math.cos(HALLEY.inclinationTilt), r};
}

/* ---------- PILA DE ETAPAS REALES (por defecto: deposito unico, igual que siempre) ---------- */
// Cada etapa: masa seca, combustible, empuje e Isp propios. La separacion es automatica al
// agotar el combustible de la etapa activa (la siguiente entra con su deposito lleno, sin salto
// de "vuelta al 100%" en la telemetria porque fuelPercent se calcula sobre el TOTAL de toda la
// mision, no solo la etapa activa).
class StageStack {
  constructor(stages){
    this.stages = stages && stages.length ? stages.map(s=>({...s})) : [
      { id:'unica', dryMass:30000, fuelMass:270000, maxFuelMass:270000, thrust:6500000, isp:450 }
    ];
    this.currentIndex = 0;
    this._totalMaxFuel = this.stages.reduce((a,s)=>a+s.maxFuelMass,0);
    this.justSeparated = null;
  }
  current(){ return this.stages[this.currentIndex]; }
  get dryMass(){ let m=0; for (let i=this.currentIndex;i<this.stages.length;i++) m+=this.stages[i].dryMass; return m; }
  get fuelMass(){ let m=0; for (let i=this.currentIndex;i<this.stages.length;i++) m+=this.stages[i].fuelMass; return m; }
  set fuelMass(v){
    const burned=this.fuelMass-v;
    const cur=this.current();
    cur.fuelMass=Math.max(0,cur.fuelMass-burned);
    if (cur.fuelMass<=0 && this.currentIndex<this.stages.length-1){
      this.justSeparated=cur.id;
      this.currentIndex++;
    }
  }
  get maxFuelMass(){ return this._totalMaxFuel; }
  get maxThrust(){ return this.current().thrust; }
  set maxThrust(v){ this.current().thrust=v; }
  get isp(){ return this.current().isp; }
  set isp(v){ this.current().isp=v; }
  reset(){ this.currentIndex=0; for (const s of this.stages) s.fuelMass=s.maxFuelMass; this.justSeparated=null; }
}

/* ---------- FISICA: motor multi-cuerpo (conicas remendadas) ---------- */
class RocketPhysics {
  constructor(){
    this.stack=new StageStack();
    const launchPos0 = latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, SOLAR_BODIES.earth.radius);
    this.x=launchPos0.x; this.y=launchPos0.y; this.z=launchPos0.z; // Kourou real, no el 'polo' del sistema de coordenadas
    this.pitch=0; this.roll=0; this.yaw=0;
    const boost0=earthRotationBoost(LAUNCH_SITE.latDeg, SOLAR_BODIES.earth.radius), east0=eastDirAt(LAUNCH_SITE.lonDeg);
    this.u=boost0*east0.x; this.v=boost0*east0.y; this.w=boost0*east0.z;
    this.pitchRate=0; this.rollRate=0; this.yawRate=0;
    this.throttle=0; this.time=0; this.hyperspace=false; this.warp=false; this.engineKind='chemical';
    this.dockedTo=null;
    this.particles=[]; this.trail=[]; this.shakeIntensity=0; this.rpm=0;
    this.G=6.67430e-11;
    this._lastState={altitude:0, bodyName:'earth', dist:SOLAR_BODIES.earth.radius, gMag:9.81, reentryFlag:false};
  }
  get dryMass(){ return this.stack.dryMass; }
  get fuelMass(){ return this.stack.fuelMass; }
  set fuelMass(v){ this.stack.fuelMass=v; }
  get maxFuelMass(){ return this.stack.maxFuelMass; }
  get maxThrust(){ return this.stack.maxThrust; }
  set maxThrust(v){ this.stack.maxThrust=v; }
  get Isp(){ return this.stack.isp; }
  set Isp(v){ this.stack.isp=v; }
  static rotateVec(vx,vy,vz,pitch,yaw,roll){
    let cz=Math.cos(roll), sz=Math.sin(roll);
    let x1=vx*cz-vy*sz, y1=vx*sz+vy*cz, z1=vz;
    let cx=Math.cos(pitch), sx=Math.sin(pitch);
    let x2=x1, y2=y1*cx-z1*sx, z2=y1*sx+z1*cx;
    let cy=Math.cos(yaw), sy=Math.sin(yaw);
    return {x:x2*cy+z2*sy, y:y2, z:-x2*sy+z2*cy};
  }
  computeAtmosphere(altitude){
    const h=Math.max(0,altitude); let T,p;
    if (h<11000){ T=288.15-0.0065*h; p=101325*Math.pow((288.15/T),5.2561); }
    else if (h<20000){ T=216.65; p=22632*Math.exp(-(h-11000)/6340); }
    else if (h<100000){ T=216.65+(h-20000)*0.001; p=5475*Math.pow((216.65/T),34.163); }
    else { T=216.65; p=0; }
    return { density: p>0?p/(287.05*T):0 };
  }
  refuel(){ const cur=this.stack.current(); cur.fuelMass=cur.maxFuelMass; }
  // Devuelve info del objetivo de acoplamiento mas cercano ALCANZABLE (mismo cuerpo dominante que la nave).
  // Generico: sirve para cualquier objetivo de DOCKING_TARGETS, no solo la plataforma de demostracion.
  nearestDockingInfo(){
    const bodyName=this._lastState.bodyName;
    let best=null;
    for (const target of DOCKING_TARGETS){
      if (target.parent!==bodyName) continue;
      const ts=dockingTargetState(target, this.time);
      const dx=this.x-ts.pos.x, dy=this.y-ts.pos.y, dz=this.z-ts.pos.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      const dvx=this.u-ts.vel.x, dvy=this.v-ts.vel.y, dvz=this.w-ts.vel.z;
      const relSpeed=Math.sqrt(dvx*dvx+dvy*dvy+dvz*dvz);
      if (!best || dist<best.dist) best={target, dist, relSpeed, canDock: dist<DOCK_MAX_DIST && relSpeed<DOCK_MAX_SPEED, ts};
    }
    return best;
  }
  tryDock(){
    const info=this.nearestDockingInfo();
    if (info && info.canDock){ this.dockedTo=info.target.id; return true; }
    return false;
  }
  undock(){
    if (!this.dockedTo) return;
    const heading=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,this.pitch,this.yaw,this.roll));
    this.u+=heading.x*1.0; this.v+=heading.y*1.0; this.w+=heading.z*1.0; // pequeño empujon de separacion
    this.dockedTo=null;
  }
  setEngine(kind){
    // Quimico: el de siempre. Nuclear (NTR): mas Isp, algo menos de empuje, solo tiene sentido en el espacio
    // (no se enciende en el lanzamiento, igual que en la vida real por seguridad/radiacion en la atmosfera).
    if (kind==='nuclear'){ this.engineKind='nuclear'; this.maxThrust=4200000; this.Isp=880; }
    else { this.engineKind='chemical'; this.maxThrust=6500000; this.Isp=450; }
  }
  static targetAngles(d){
    const dy=Math.max(-1,Math.min(1,d.y));
    const pitch=Math.acos(dy);
    const sinP=Math.sin(pitch);
    const yaw = Math.abs(sinP)<1e-6 ? 0 : Math.atan2(d.x/sinP, d.z/sinP);
    return {pitch,yaw};
  }
  static wrapAngle(a){ while(a>Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; }
  // Piloto automatico de actitud (SAS): calcula ordenes de pitch/yaw/roll para apuntar hacia 'dir'.
  // Probado por separado: converge exactamente al objetivo (ver prueba previa a esta integracion).
  autopilotSteer(dir){
    const localDir=FRAME_ROTATION_INV(dir);
    const {pitch:pt,yaw:yt}=RocketPhysics.targetAngles(localDir);
    const Kp=3.0, Kd=2.0;
    const pitchErr=RocketPhysics.wrapAngle(pt-this.pitch), yawErr=RocketPhysics.wrapAngle(yt-this.yaw), rollErr=RocketPhysics.wrapAngle(0-this.roll);
    return {
      pitch:Math.max(-1,Math.min(1,Kp*pitchErr-Kd*this.pitchRate)),
      yaw:Math.max(-1,Math.min(1,Kp*yawErr-Kd*this.yawRate)),
      roll:Math.max(-1,Math.min(1,Kp*rollErr-Kd*this.rollRate))
    };
  }
  step(rawDt, controls){
    const frameDt=Math.min(rawDt,0.05);
    const timeScale=controls.timeScale||1;
    let remaining=frameDt*timeScale;
    const MAX_SUBSTEPS=500;
    let n=0;
    while (remaining>1e-6 && n<MAX_SUBSTEPS){
      const s=this._lastState;
      const bMass=SOLAR_BODIES[s.bodyName]?SOLAR_BODIES[s.bodyName].mass:this.G;
      const period=2*Math.PI*Math.sqrt(Math.pow(s.dist,3)/(this.G*bMass));
      const dynSub=Math.max(0.05, Math.min(3600, isFinite(period)?period/2000:3600));
      const sub=Math.min(dynSub, remaining);
      this._integrate(sub, controls);
      remaining-=sub; n++;
    }
    return this.getState();
  }
  _integrate(dt, controls){
    this.time+=dt;
    this.throttle=Math.max(0,Math.min(1,controls.throttle||0));
    const pitchCmd=Math.max(-1,Math.min(1,controls.pitch||0));
    const yawCmd=Math.max(-1,Math.min(1,controls.yaw||0));
    const rollCmd=Math.max(-1,Math.min(1,controls.roll||0));
    if (controls.hyperspace!==undefined) this.hyperspace=controls.hyperspace;
    if (controls.warp!==undefined) this.warp=controls.warp;

    if (this.dockedTo){
      const target=DOCKING_TARGETS.find(t=>t.id===this.dockedTo);
      if (!target){ this.dockedTo=null; }
      else if (this.throttle>0.3){ this.undock(); }
      else {
        const ts=dockingTargetState(target, this.time);
        this.x=ts.pos.x; this.y=ts.pos.y; this.z=ts.pos.z;
        this.u=ts.vel.x; this.v=ts.vel.y; this.w=ts.vel.z;
        const parent=SOLAR_BODIES[target.parent];
        this._lastState={altitude:ts.r-parent.radius, bodyName:target.parent, dist:ts.r, gMag:6.67430e-11*parent.mass/(ts.r*ts.r), reentryFlag:false};
        return;
      }
    }

    const prevBody=this._lastState.bodyName;
    const prevBodyPos=positionOf(prevBody,this.time);
    const absPos={x:prevBodyPos.x+this.x, y:prevBodyPos.y+this.y, z:prevBodyPos.z+this.z};

    let best=null, bestSoi=Infinity;
    for (const name of SOLAR_BODY_NAMES){
      const bp=positionOf(name,this.time);
      const dx=absPos.x-bp.x, dy=absPos.y-bp.y, dz=absPos.z-bp.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      const soi=soiOf(name);
      if (dist<soi && soi<bestSoi){ bestSoi=soi; best={name,dist,bp}; }
    }
    let bodyName,dist,bodyPos,bodyMass,bodyRadius;
    if (best){ bodyName=best.name; dist=best.dist; bodyPos=best.bp; }
    else { bodyName='sun'; bodyPos={x:0,y:0,z:0}; dist=Math.sqrt(absPos.x**2+absPos.y**2+absPos.z**2); }
    bodyMass=SOLAR_BODIES[bodyName].mass; bodyRadius=SOLAR_BODIES[bodyName].radius;

    this.x=absPos.x-bodyPos.x; this.y=absPos.y-bodyPos.y; this.z=absPos.z-bodyPos.z;

    const gMag=this.G*bodyMass/(dist*dist);
    const gDir={x:-this.x/dist, y:-this.y/dist, z:-this.z/dist};
    const mass=this.dryMass+this.fuelMass;
    const gravityForce={x:gDir.x*gMag*mass, y:gDir.y*gMag*mass, z:gDir.z*gMag*mass};

    const isEarth = bodyName==='earth';
    const atm = isEarth ? this.computeAtmosphere(dist-bodyRadius) : {density:0};
    const rho=atm.density;
    const velocity=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    const drag=0.5*rho*velocity*velocity*0.5*10;
    let dragVec={x:0,y:0,z:0};
    if (velocity>0.1){ dragVec={x:-drag*(this.u/velocity),y:-drag*(this.v/velocity),z:-drag*(this.w/velocity)}; }

    let thrust=0;
    if (this.fuelMass>0 && this.throttle>0){
      thrust=this.maxThrust*this.throttle;
      const fuelBurn=thrust/(this.Isp*9.81)*dt;
      this.fuelMass=Math.max(0,this.fuelMass-fuelBurn);
    }
    const effPitch=this.pitch+pitchCmd*0.05;
    const heading=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,effPitch,this.yaw,this.roll));
    const thrustVec={x:thrust*heading.x,y:thrust*heading.y,z:thrust*heading.z};

    const ax=(thrustVec.x+dragVec.x+gravityForce.x)/mass;
    const ay=(thrustVec.y+dragVec.y+gravityForce.y)/mass;
    const az=(thrustVec.z+dragVec.z+gravityForce.z)/mass;
    this.u+=ax*dt; this.v+=ay*dt; this.w+=az*dt;

    const rcsTorque=1000000*(1+this.throttle*0.5);
    this.pitchRate+=(pitchCmd*rcsTorque/2000000)*dt;
    this.yawRate+=(yawCmd*rcsTorque/2000000)*dt;
    this.rollRate+=(rollCmd*rcsTorque/1000000)*dt;
    // frenado por SEGUNDO real (no por sub-paso): antes, con sub-pasos adaptativos grandes cerca
    // de la Tierra, el mismo factor aplicado una vez por sub-paso apenas frenaba nada.
    const DAMP_PER_SEC=0.15;
    this.pitchRate*=Math.pow(DAMP_PER_SEC,dt); this.yawRate*=Math.pow(DAMP_PER_SEC,dt); this.rollRate*=Math.pow(DAMP_PER_SEC,dt);
    this.pitch+=this.pitchRate*dt; this.yaw+=this.yawRate*dt; this.roll+=this.rollRate*dt;

    this.x+=this.u*dt; this.y+=this.v*dt; this.z+=this.w*dt;

    if (this.hyperspace){
      const maxHyperSpeed=2500;
      let speed=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
      let dirx,diry,dirz;
      if (speed<1){ dirx=heading.x;diry=heading.y;dirz=heading.z; speed=1; }
      else { dirx=this.u/speed; diry=this.v/speed; dirz=this.w/speed; }
      const newSpeed=Math.min(maxHyperSpeed, speed+800*dt);
      this.u=dirx*newSpeed; this.v=diry*newSpeed; this.w=dirz*newSpeed;
      for (let i=0;i<5;i++){
        this.particles.push({x:this.x+(Math.random()-0.5)*20,y:this.y+(Math.random()-0.5)*20,z:this.z+(Math.random()-0.5)*20,
          vx:(Math.random()-0.5)*200,vy:(Math.random()-0.5)*200,vz:(Math.random()-0.5)*200,
          life:0.2+Math.random()*0.3,maxLife:0.2+Math.random()*0.3,size:0.5+Math.random()*2,color:[1,0.2,1]});
      }
    }
    if (this.warp){
      const maxWarpSpeed=600;
      let speedW=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
      let wdx,wdy,wdz;
      if (speedW<1){ wdx=heading.x;wdy=heading.y;wdz=heading.z; speedW=1; }
      else { wdx=this.u/speedW; wdy=this.v/speedW; wdz=this.w/speedW; }
      const newSpeedW=Math.min(maxWarpSpeed, speedW+150*dt);
      this.u=wdx*newSpeedW; this.v=wdy*newSpeedW; this.w=wdz*newSpeedW;
      for (let i=0;i<3;i++){
        const angle=Math.random()*Math.PI*2, radius=5+Math.random()*15;
        this.particles.push({x:this.x+Math.cos(angle)*radius,y:this.y+Math.sin(angle)*radius+5,z:this.z+(Math.random()-0.5)*10,
          vx:-Math.cos(angle)*5,vy:-Math.sin(angle)*5,vz:(Math.random()-0.5)*2,
          life:0.3+Math.random()*0.5,maxLife:0.3+Math.random()*0.5,size:1+Math.random()*3,color:[0,0.8,1]});
      }
    }
    if (this.throttle>0.05 && this.fuelMass>0){
      const count=Math.floor(10+this.throttle*30), speed=5+this.throttle*20, spread=0.3+this.throttle*0.5;
      const flameDir=RocketPhysics.rotateVec(0,-1,0,effPitch,this.yaw,this.roll);
      for (let i=0;i<count;i++){
        const angle=Math.random()*Math.PI*2, radius=Math.random()*spread;
        this.particles.push({
          x:this.x+flameDir.x*8+Math.cos(angle)*radius, y:this.y+flameDir.y*8+Math.sin(angle)*radius, z:this.z+flameDir.z*8+(Math.random()-0.5)*spread,
          vx:flameDir.x*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          vy:flameDir.y*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          vz:flameDir.z*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          life:0.3+Math.random()*0.8,maxLife:0.3+Math.random()*0.8,
          size:0.5+Math.random()*2,color:[1,0.5+Math.random()*0.3,0.1+Math.random()*0.2]});
      }
    }
    const reentryNow = isEarth && (dist-bodyRadius)<80000 && (dist-bodyRadius)>100 && velocity>2000 && this.v<0;
    if (reentryNow){
      const heat=Math.min(1,(velocity-2000)/4000);
      const count=Math.floor(6+heat*20);
      for (let i=0;i<count;i++){
        this.particles.push({x:this.x+(Math.random()-0.5)*1.2,y:this.y+(Math.random()-0.5)*1.2,z:this.z+(Math.random()-0.5)*1.2,
          vx:(Math.random()-0.5)*4-this.u*0.1, vy:(Math.random()-0.5)*4-this.v*0.05, vz:(Math.random()-0.5)*4,
          life:0.15+Math.random()*0.25, maxLife:0.15+Math.random()*0.25, size:0.8+Math.random()*2.5*heat,
          color: heat>0.6?[1,1,1]:[1,0.4+heat*0.3,0.1]});
      }
    }

    const d2=Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z);
    let finalDist=d2;
    if (d2<bodyRadius){
      const nx=this.x/d2, ny=this.y/d2, nz=this.z/d2;
      this.x=nx*bodyRadius; this.y=ny*bodyRadius; this.z=nz*bodyRadius;
      const vRad=this.u*nx+this.v*ny+this.w*nz;
      if (vRad<0){ this.u-=vRad*nx; this.v-=vRad*ny; this.w-=vRad*nz; }
      finalDist=bodyRadius; // ya corregido exactamente a la superficie: la altitud reportada debe ser 0, no la de antes de corregir
    }

    const MAX_SPEED=200000;
    const spd=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    if (!isFinite(spd)){ this.u=0;this.v=0;this.w=0; }
    else if (spd>MAX_SPEED){ const s=MAX_SPEED/spd; this.u*=s; this.v*=s; this.w*=s; }

    if (this.throttle>0.1) this.shakeIntensity=this.throttle*0.3+Math.random()*0.1;
    else this.shakeIntensity*=0.95;
    this.rpm=this.throttle*6000+800;

    this.updateParticles(dt);
    if (this.trail.length===0 || this.time%2<0.1){
      this.trail.push({x:absPos.x,y:absPos.y,z:absPos.z});
      if (this.trail.length>400) this.trail.shift();
    }

    this._lastState={altitude:finalDist-bodyRadius, bodyName, dist:finalDist, gMag, reentryFlag:reentryNow};
  }
  updateParticles(dt){
    for (let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];
      p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt; p.life-=dt; p.size*=0.995;
      if (p.life<=0 || p.size<0.1) this.particles.splice(i,1);
    }
  }
  getState(){
    const velocity=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    const s=this._lastState;
    const bodyMass=SOLAR_BODIES[s.bodyName].mass;
    const vCirc=Math.sqrt(this.G*bodyMass/Math.max(1,s.dist));
    const vertRatio=velocity>1?Math.abs(this.v)/velocity:1;
    const orbitAltThresh = s.bodyName==='earth'?80000:(SOLAR_BODIES[s.bodyName].radius*0.05);
    const inOrbit = s.altitude>orbitAltThresh && velocity>vCirc*0.85 && velocity<vCirc*1.3 && vertRatio<0.2;
    const ascending = !inOrbit && s.altitude>orbitAltThresh*0.6 && velocity>vCirc*0.6;

    const bodyPos=positionOf(s.bodyName,this.time);
    const shipAbs={x:bodyPos.x+this.x, y:bodyPos.y+this.y, z:bodyPos.z+this.z};
    const worldBodies={};
    for (const name of SOLAR_BODY_NAMES) worldBodies[name]=positionOf(name,this.time);
    worldBodies.sun={x:0,y:0,z:0};
    worldBodies.halley=halleyPosition(this.time);

    // Eclipses: alineacion geometrica Sol-Tierra-Luna. Aviso: al ser orbitas coplanares simplificadas
    // (sin la inclinacion real de 5 grados de la Luna), esto se alinea cada mes en vez de ser raro como en la realidad.
    const vSun={x:-worldBodies.earth.x,y:-worldBodies.earth.y,z:-worldBodies.earth.z};
    const vMoon={x:worldBodies.moon.x-worldBodies.earth.x,y:worldBodies.moon.y-worldBodies.earth.y,z:worldBodies.moon.z-worldBodies.earth.z};
    const dot=vSun.x*vMoon.x+vSun.y*vMoon.y+vSun.z*vMoon.z;
    const magP=Math.sqrt(vSun.x**2+vSun.y**2+vSun.z**2)*Math.sqrt(vMoon.x**2+vMoon.y**2+vMoon.z**2);
    const angSunMoon=Math.acos(Math.max(-1,Math.min(1,dot/magP)));
    let eclipse=null;
    if (angSunMoon<0.03) eclipse='solar';
    else if (Math.abs(Math.PI-angSunMoon)<0.03) eclipse='lunar';

    // velocidad vertical/horizontal REALES: componente radial (hacia/desde el centro del cuerpo) vs tangencial.
    // OJO: esto no es simplemente 'v' (eje Y) salvo que el punto este justo "encima" del cuerpo en Y;
    // en cualquier otro punto de la superficie (o en otro planeta) 'arriba' es la direccion desde el centro, no el eje Y fijo.
    const rx=this.x/s.dist, ry=this.y/s.dist, rz=this.z/s.dist;
    const vertSpeed = this.u*rx+this.v*ry+this.w*rz;
    const horizSpeed = Math.sqrt(Math.max(0, velocity*velocity - vertSpeed*vertSpeed));

    const dockInfo=this.nearestDockingInfo();

    return {
      x:this.x,y:this.y,z:this.z,pitch:this.pitch,roll:this.roll,yaw:this.yaw,
      u:this.u,v:this.v,w:this.w,velocity,altitude:s.altitude,body:s.bodyName,
      fuelMass:this.fuelMass,fuelPercent:this.fuelMass/this.maxFuelMass*100,
      mass:this.dryMass+this.fuelMass,throttle:this.throttle,thrust:this.maxThrust*this.throttle,
      time:this.time,gForce:s.gMag/9.81,hyperspace:this.hyperspace,warp:this.warp,
      particles:this.particles,trail:this.trail,shakeIntensity:this.shakeIntensity,rpm:this.rpm,
      vCirc,inOrbit,ascending,reentry:!!s.reentryFlag,engineKind:this.engineKind,eclipse,
      vertSpeed,horizSpeed,dockedTo:this.dockedTo,dockInfo,
      shipAbs, bodies:worldBodies
    };
  }
  reset(){
    const launchPosR = latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, SOLAR_BODIES.earth.radius);
    this.x=launchPosR.x;this.y=launchPosR.y;this.z=launchPosR.z;this.pitch=0;this.roll=0;this.yaw=0;
    const boost1=earthRotationBoost(LAUNCH_SITE.latDeg, SOLAR_BODIES.earth.radius), east1=eastDirAt(LAUNCH_SITE.lonDeg);
    this.u=boost1*east1.x;this.v=boost1*east1.y;this.w=boost1*east1.z;
    this.pitchRate=0;this.rollRate=0;this.yawRate=0;
    this.throttle=0;this.stack.reset();this.time=0;
    this.hyperspace=false;this.warp=false;this.particles=[];this.trail=[];
    this.shakeIntensity=0;this.rpm=0;this.dockedTo=null;
    this._lastState={altitude:0, bodyName:'earth', dist:SOLAR_BODIES.earth.radius, gMag:9.81, reentryFlag:false};
  }
}
class SoundSystem {
  constructor(){ this.enabled=false; this.ctx=null; this.oscillators=[]; this.gains=[]; this.filters=[]; this.lastThrottle=0; this.lastRPM=0; this.initialized=false; }
  init(){ try { this.ctx=new (window.AudioContext||window.webkitAudioContext)(); this.enabled=true; this.initialized=true; return true; } catch(e){ this.enabled=false; return false; } }
  toggle(){
    if (!this.initialized) return this.init();
    if (this.ctx.state==='suspended'){ this.ctx.resume(); this.enabled=true; }
    else if (this.ctx.state==='running'){ this.ctx.suspend(); this.enabled=false; }
  }
  update(throttle,rpm,gForce,velocity,altitude){
    if (!this.enabled || this.ctx.state!=='running') return;
    if (Math.abs(throttle-this.lastThrottle)>0.3) this.stopAll();
    if (throttle>0.02) this.playEngine(throttle,rpm,gForce,velocity,altitude);
    else this.playAmbient(velocity,altitude);
    this.lastThrottle=throttle; this.lastRPM=rpm;
  }
  playEngine(throttle,rpm,gForce,velocity,altitude){
    if (this.oscillators.length>10) this.stopAll();
    const baseFreq=40+rpm*0.08+throttle*60;
    const osc1=this.ctx.createOscillator(), gain1=this.ctx.createGain(), filter1=this.ctx.createBiquadFilter();
    osc1.type='sawtooth'; osc1.frequency.value=baseFreq*0.5;
    filter1.type='lowpass'; filter1.frequency.value=200+throttle*800+rpm*0.2; filter1.Q.value=1.5;
    gain1.gain.value=0.15*throttle*(1+gForce*0.1);
    osc1.connect(filter1); filter1.connect(gain1); gain1.connect(this.ctx.destination); osc1.start();
    this.oscillators.push(osc1); this.gains.push(gain1); this.filters.push(filter1);
    const osc2=this.ctx.createOscillator(), gain2=this.ctx.createGain();
    osc2.type='square'; osc2.frequency.value=baseFreq*1.5+throttle*120; gain2.gain.value=0.06*throttle;
    osc2.connect(gain2); gain2.connect(this.ctx.destination); osc2.start();
    this.oscillators.push(osc2); this.gains.push(gain2);
    const osc3=this.ctx.createOscillator(), gain3=this.ctx.createGain();
    osc3.type='sine'; osc3.frequency.value=200+throttle*300+rpm*0.05; gain3.gain.value=0.04*throttle;
    osc3.connect(gain3); gain3.connect(this.ctx.destination); osc3.start();
    this.oscillators.push(osc3); this.gains.push(gain3);
    if (velocity>50){
      const doppler=this.ctx.createOscillator(), dopplerGain=this.ctx.createGain();
      doppler.type='sine'; doppler.frequency.value=100+velocity*0.5;
      dopplerGain.gain.value=0.02*Math.min(1,velocity/200);
      doppler.connect(dopplerGain); dopplerGain.connect(this.ctx.destination); doppler.start();
      this.oscillators.push(doppler); this.gains.push(dopplerGain);
    }
    if (gForce>2){
      const vib=this.ctx.createOscillator(), vibGain=this.ctx.createGain();
      vib.type='sine'; vib.frequency.value=20+(gForce-2)*10;
      vibGain.gain.value=0.1*Math.min(1,(gForce-2)/5);
      vib.connect(vibGain); vibGain.connect(this.ctx.destination); vib.start();
      this.oscillators.push(vib); this.gains.push(vibGain);
    }
  }
  playAmbient(velocity,altitude){
    if (velocity>5){
      const bufferSize=this.ctx.sampleRate*0.1;
      const buffer=this.ctx.createBuffer(1,bufferSize,this.ctx.sampleRate);
      const data=buffer.getChannelData(0);
      for (let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.05;
      const source=this.ctx.createBufferSource(); source.buffer=buffer; source.loop=true;
      const gain=this.ctx.createGain(); gain.gain.value=0.03*Math.min(1,velocity/100)*(1-Math.min(1,altitude/50000));
      const filter=this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=100+velocity*2;
      source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); source.start();
      this.oscillators.push(source); this.gains.push(gain); this.filters.push(filter);
    }
  }
  stopAll(){
    this.oscillators.forEach(o=>{ try{o.stop();}catch(e){} try{o.disconnect();}catch(e){} });
    this.oscillators=[]; this.gains=[]; this.filters=[];
  }
}

/* ---------- NOTIFICACIONES ---------- */
class ToastSystem {
  constructor(){ this.timeout=null; }
  show(msg, duration=3000){
    const el=document.getElementById('toastMsg');
    if (!el) return;
    el.textContent=msg;
    el.classList.add('show');
    clearTimeout(this.timeout);
    this.timeout=setTimeout(()=>el.classList.remove('show'), duration);
  }
}

/* ---------- TEXTURAS PROCEDURALES ---------- */
function makeEarthTexture(){
  const c=document.createElement('canvas'); c.width=1024; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#0d3d66'; ctx.fillRect(0,0,1024,512);
  const grad=ctx.createLinearGradient(0,0,0,512);
  grad.addColorStop(0,'#0a2a4a'); grad.addColorStop(0.5,'#0f4a7a'); grad.addColorStop(1,'#0a2a4a');
  ctx.fillStyle=grad; ctx.fillRect(0,0,1024,512);
  function blob(cx,cy,rx,ry,color){
    ctx.fillStyle=color;
    ctx.beginPath();
    const pts=14;
    for(let i=0;i<=pts;i++){
      const a=(i/pts)*Math.PI*2;
      const jitter=0.75+Math.random()*0.5;
      const x=cx+Math.cos(a)*rx*jitter;
      const y=cy+Math.sin(a)*ry*jitter;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }
  const green='#3d6b35', tan='#8a7a4f', darkgreen='#2d5028';
  blob(180,190,90,120,green); blob(200,300,70,90,darkgreen);
  blob(330,150,110,60,tan); blob(420,120,60,50,green);
  blob(560,140,140,70,tan); blob(600,260,90,110,green);
  blob(520,320,60,50,darkgreen);
  blob(780,150,120,90,tan); blob(830,260,70,80,green);
  blob(870,90,80,50,tan);
  blob(900,380,100,60,green);
  // detalle extra: manchas mas pequenas para romper la silueta lisa de los blobs grandes
  for (let i=0;i<40;i++){
    const cx=Math.random()*1024, cy=90+Math.random()*350;
    blob(cx,cy,8+Math.random()*20,6+Math.random()*15, Math.random()>0.5?green:tan);
  }
  ctx.fillStyle='#eef4f8';
  ctx.fillRect(0,0,1024,22); ctx.fillRect(0,490,1024,22);
  return new THREE.CanvasTexture(c);
}
function makeCloudsTexture(){
  const c=document.createElement('canvas'); c.width=1024; c.height=512;
  const ctx=c.getContext('2d');
  // fondo transparente: las nubes son solo las manchas blancas
  for (let i=0;i<90;i++){
    const cx=Math.random()*1024, cy=Math.random()*512;
    const rx=20+Math.random()*70, ry=10+Math.random()*30;
    const alpha=0.15+Math.random()*0.35;
    ctx.fillStyle=`rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    const pts=10;
    for(let j=0;j<=pts;j++){
      const a=(j/pts)*Math.PI*2;
      const jitter=0.7+Math.random()*0.6;
      const x=cx+Math.cos(a)*rx*jitter, y=cy+Math.sin(a)*ry*jitter;
      if(j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
function makeRockyTexture(baseColor, spotColor, features){
  features = features || {};
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hex=n=>'#'+n.toString(16).padStart(6,'0');
  ctx.fillStyle=hex(baseColor); ctx.fillRect(0,0,512,256);
  for (let i=0;i<120;i++){
    const x=Math.random()*512, y=Math.random()*256, r=3+Math.random()*18;
    ctx.fillStyle=hex(spotColor); ctx.globalAlpha=0.2+Math.random()*0.3;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  if (features.canyon){
    // un cañón largo tipo Valles Marineris: una franja oscura irregular cerca del ecuador
    ctx.globalAlpha=0.5; ctx.fillStyle=hex(spotColor);
    let y=128;
    for (let x=60;x<380;x+=8){
      y += (Math.random()-0.5)*6;
      ctx.fillRect(x,y,10,5+Math.random()*4);
    }
  }
  if (features.polarCaps){
    ctx.globalAlpha=0.9; ctx.fillStyle='#eef4f8';
    ctx.fillRect(0,0,512,16); ctx.fillRect(0,240,512,16);
  }
  ctx.globalAlpha=1;
  return new THREE.CanvasTexture(c);
}
function makeBandedTexture(colorA, colorB, greatSpot){
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hexA=colorA.toString(16).padStart(6,'0'), hexB=colorB.toString(16).padStart(6,'0');
  const bands=14;
  for (let i=0;i<bands;i++){
    ctx.fillStyle = i%2===0 ? '#'+hexA : '#'+hexB;
    ctx.fillRect(0, i*(256/bands), 512, 256/bands+1);
  }
  for (let i=0;i<40;i++){
    const y=Math.random()*256, x=Math.random()*512, w=30+Math.random()*100;
    ctx.fillStyle = Math.random()>0.5 ? '#'+hexA : '#'+hexB;
    ctx.globalAlpha=0.2;
    ctx.fillRect(x,y,w,4+Math.random()*8);
  }
  if (greatSpot){
    // la Gran Mancha Roja: ovalo caracteristico en el hemisferio sur de Jupiter
    ctx.globalAlpha=0.85; ctx.fillStyle='#c1440e';
    ctx.beginPath(); ctx.ellipse(340,175,55,28,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=0.4; ctx.fillStyle='#8a2f08';
    ctx.beginPath(); ctx.ellipse(340,175,55,28,0,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha=1;
  return new THREE.CanvasTexture(c);
}
function makeIceTexture(baseColor){
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hex=baseColor.toString(16).padStart(6,'0');
  ctx.fillStyle='#'+hex; ctx.fillRect(0,0,512,256);
  ctx.strokeStyle='rgba(120,140,160,0.5)'; ctx.lineWidth=1.5;
  for (let i=0;i<25;i++){
    ctx.beginPath();
    let x=Math.random()*512, y=Math.random()*256;
    ctx.moveTo(x,y);
    const segs=4+Math.floor(Math.random()*4);
    for (let j=0;j<segs;j++){
      x+=(Math.random()-0.5)*80; y+=(Math.random()-0.5)*40;
      ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
function makeMoonTexture(){
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#b8b2a8'; ctx.fillRect(0,0,512,256);
  for(let i=0;i<70;i++){
    const x=Math.random()*512, y=Math.random()*256, r=4+Math.random()*22;
    ctx.fillStyle=Math.random()>0.5?'rgba(120,115,108,0.5)':'rgba(200,195,188,0.4)';
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

/* ---------- RENDERER 3D ---------- */
class RocketRenderer3D {
  constructor(container){
    this.container=container;
    const width=container.clientWidth, height=container.clientHeight;
    this.R_earth=6371000;

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x03030a);

    this.camera=new THREE.PerspectiveCamera(55,width/height,0.5,9000000000000);
    this.camera.position.set(35,25,45); this.camera.lookAt(0,0,0);

    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance",logarithmicDepthBuffer:true});
    this.renderer.setSize(width,height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure=1.2;
    container.appendChild(this.renderer.domElement);

    this.composer=new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene,this.camera));
    this.bloomPass=new THREE.UnrealBloomPass(new THREE.Vector2(width,height),0.3,0.2,0.1);
    this.composer.addPass(this.bloomPass);

    this.controls=new THREE.OrbitControls(this.camera,this.renderer.domElement);
    this.controls.target.set(0,5,0); this.controls.enableDamping=true; this.controls.dampingFactor=0.08;
    this.controls.maxPolarAngle=Math.PI/2.1; this.controls.minDistance=5; this.controls.maxDistance=300;
    this.controls.update();

    this.setupLights(); this.setupScene(); this.setupSolarSystem();

    this.rocketGroup=new THREE.Group(); this.scene.add(this.rocketGroup); this.buildRocket();
    this.engineGlow=null; this.flameMeshes=[]; this.engineLight=null;

    this.particleSystem=new THREE.BufferGeometry();
    this.particleMaterial=new THREE.PointsMaterial({size:0.5,transparent:true,opacity:0.8,blending:THREE.AdditiveBlending,sizeAttenuation:true,vertexColors:true});
    this.particlePoints=new THREE.Points(this.particleSystem,this.particleMaterial);
    this.scene.add(this.particlePoints);

    this.trailLine=null; this.viewMode='external';

    this.setupMiniViews();

    this.resizeHandler=this.resize.bind(this);
    window.addEventListener('resize',this.resizeHandler);
  }
  setupLights(){
    this.scene.add(new THREE.AmbientLight(0x223355,0.5));
    const sun=new THREE.DirectionalLight(0xffeedd,1.8);
    sun.position.set(6000,10000,4000); sun.castShadow=true;
    sun.shadow.mapSize.width=2048; sun.shadow.mapSize.height=2048;
    sun.shadow.camera.near=0.5; sun.shadow.camera.far=300;
    sun.shadow.camera.left=-80; sun.shadow.camera.right=80; sun.shadow.camera.top=80; sun.shadow.camera.bottom=-80;
    this.scene.add(sun); this.sun=sun;
    const fill=new THREE.DirectionalLight(0x4488ff,0.5); fill.position.set(-40,50,-30); this.scene.add(fill);
    const rim=new THREE.DirectionalLight(0x4466aa,0.3); rim.position.set(0,-20,-60); this.scene.add(rim);
    const pointLight=new THREE.PointLight(0xff4400,0,30); pointLight.position.set(0,-5,0);
    this.scene.add(pointLight); this.engineLight=pointLight;
  }
  setupScene(){
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400), new THREE.MeshStandardMaterial({color:0x0a0a15,roughness:0.9,metalness:0.1}));
    ground.rotation.x=-Math.PI/2; ground.position.y=-0.5; ground.receiveShadow=true; this.scene.add(ground); this.ground=ground;
    const gridHelper=new THREE.GridHelper(400,80,0x1a2a4a,0x0a1a2a); gridHelper.position.y=-0.45; this.scene.add(gridHelper); this.grid=gridHelper;

    const starCount=6000;
    const starGeo=new THREE.BufferGeometry();
    const positions=new Float32Array(starCount*3), colors=new Float32Array(starCount*3), sizes=new Float32Array(starCount);
    for (let i=0;i<starCount;i++){
      const theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1), r=20000000+Math.random()*40000000;
      positions[i*3]=r*Math.sin(phi)*Math.cos(theta);
      positions[i*3+1]=r*Math.cos(phi);
      positions[i*3+2]=r*Math.sin(phi)*Math.sin(theta);
      const temp=0.5+Math.random()*0.5;
      colors[i*3]=1.0; colors[i*3+1]=0.8+temp*0.2; colors[i*3+2]=0.6+temp*0.4;
      sizes[i]=0.3+Math.random()*1.5;
    }
    starGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    starGeo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    starGeo.setAttribute('size',new THREE.BufferAttribute(sizes,1));
    const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({size:9000,transparent:true,opacity:0.9,vertexColors:true,sizeAttenuation:true}));
    this.scene.add(stars); this.stars=stars; this.starClock=0;
  }
  setupSolarSystem(){
    this.bodyMeshes = {};

    // Sol: esfera emisiva (luz visual, no recalculamos sombras reales a esta escala)
    const sunMat=new THREE.MeshBasicMaterial({color:0xfff2cc});
    this.sun3d=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.sun.radius,32,32),sunMat);
    this.scene.add(this.sun3d); this.bodyMeshes.sun=this.sun3d;

    // Tierra: intenta una foto real (NASA/LRO vía CDN publico); si el navegador la bloquea
    // (politica CORS de algunos servidores), cae solas a la textura procedural sin romper nada.
    const earthMat=new THREE.MeshStandardMaterial({map:makeEarthTexture(),roughness:0.85,metalness:0.05});
    const realEarthLoader=new THREE.TextureLoader();
    realEarthLoader.load(
      'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg',
      (tex)=>{ earthMat.map=tex; earthMat.needsUpdate=true; },
      undefined,
      ()=>{ console.warn('Textura real de la Tierra bloqueada, usando la procedural.'); }
    );
    this.earth=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius,64,64),earthMat);
    this.scene.add(this.earth); this.bodyMeshes.earth=this.earth;

    // Marcadores de Baikonur (despegue) y Smelovka (aterrizaje), solo en la mision Gagarin.
    // Se colocan en el MISMO marco fijo que usa la fisica de la nave (no giran con la textura
    // de la Tierra) para que coincidan siempre con el punto real de despegue/aterrizaje de la
    // simulacion, en vez de desplazarse con la rotacion terrestre a lo largo de la mision.
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin'){
      const pinMat=new THREE.MeshBasicMaterial({color:0xff3355});
      const landMat=new THREE.MeshBasicMaterial({color:0x33ff77});
      const markerR=SOLAR_BODIES.earth.radius*0.018;
      this.baikonurOffset=latLonToXYZ(45.92,63.34,SOLAR_BODIES.earth.radius*1.015);
      this.baikonurMarker=new THREE.Mesh(new THREE.SphereGeometry(markerR,10,10),pinMat);
      this.scene.add(this.baikonurMarker);
      this.smelovkaOffset=latLonToXYZ(51.27,45.99,SOLAR_BODIES.earth.radius*1.015);
      this.smelovkaMarker=new THREE.Mesh(new THREE.SphereGeometry(markerR,10,10),landMat);
      this.scene.add(this.smelovkaMarker);
    }

    const cloudsMat=new THREE.MeshStandardMaterial({map:makeCloudsTexture(),transparent:true,depthWrite:false,roughness:1});
    this.clouds=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius*1.008,64,64),cloudsMat);
    this.scene.add(this.clouds);

    const atmoMat=new THREE.MeshBasicMaterial({color:0x66aaff,transparent:true,opacity:0.18,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
    this.atmosphere=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius*1.025,48,48),atmoMat);
    this.scene.add(this.atmosphere);

    // Luna
    const moonMat=new THREE.MeshStandardMaterial({map:makeMoonTexture(),roughness:0.95,metalness:0.02});
    this.moon=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.moon.radius,48,48),moonMat);
    this.scene.add(this.moon); this.bodyMeshes.moon=this.moon;

    // Marte
    const marsMat=new THREE.MeshStandardMaterial({map:makeRockyTexture(0xc1440e,0x7a2a08,{polarCaps:true,canyon:true}),roughness:0.9});
    this.bodyMeshes.mars=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.mars.radius,48,48),marsMat);
    this.scene.add(this.bodyMeshes.mars);

    // Jupiter y sus lunas galileanas
    const jupMat=new THREE.MeshStandardMaterial({map:makeBandedTexture(0xd8ae6f,0xb08050,true),roughness:0.7});
    this.bodyMeshes.jupiter=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.jupiter.radius,48,48),jupMat);
    this.scene.add(this.bodyMeshes.jupiter);
    ['io','europa','ganymede','callisto'].forEach(name=>{
      const mat = name==='europa'
        ? new THREE.MeshStandardMaterial({map:makeIceTexture(SOLAR_BODIES.europa.color),roughness:0.6})
        : new THREE.MeshStandardMaterial({color:SOLAR_BODIES[name].color,roughness:0.9});
      this.bodyMeshes[name]=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES[name].radius,24,24),mat);
      this.scene.add(this.bodyMeshes[name]);
    });

    // Saturno con anillos, y Titan
    const satMat=new THREE.MeshStandardMaterial({map:makeBandedTexture(0xead6a8,0xc9a76a),roughness:0.7});
    this.bodyMeshes.saturn=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.saturn.radius,48,48),satMat);
    this.scene.add(this.bodyMeshes.saturn);
    const ringGeo=new THREE.RingGeometry(SOLAR_BODIES.saturn.radius*1.3,SOLAR_BODIES.saturn.radius*2.3,64);
    const ringMat=new THREE.MeshBasicMaterial({color:0xd8c9a0,transparent:true,opacity:0.6,side:THREE.DoubleSide});
    this.saturnRing=new THREE.Mesh(ringGeo,ringMat); this.saturnRing.rotation.x=Math.PI/2.3;
    this.scene.add(this.saturnRing);
    const titanMat=new THREE.MeshStandardMaterial({color:SOLAR_BODIES.titan.color,roughness:0.85});
    this.bodyMeshes.titan=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.titan.radius,24,24),titanMat);
    this.scene.add(this.bodyMeshes.titan);

    // Urano, Neptuno, Pluton
    ['uranus','neptune','pluto'].forEach(name=>{
      const mat=new THREE.MeshStandardMaterial({color:SOLAR_BODIES[name].color,roughness:0.8});
      this.bodyMeshes[name]=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES[name].radius,32,32),mat);
      this.scene.add(this.bodyMeshes[name]);
    });
    // Anillo de Urano: real, pero muy distinto al de Saturno - fino, oscuro/grisaceo,
    // y casi vertical porque el eje de Urano esta inclinado ~98 grados (gira "tumbado").
    const uranusRingGeo=new THREE.RingGeometry(SOLAR_BODIES.uranus.radius*1.6,SOLAR_BODIES.uranus.radius*2.0,64);
    const uranusRingMat=new THREE.MeshBasicMaterial({color:0x556570,transparent:true,opacity:0.35,side:THREE.DoubleSide});
    this.uranusRing=new THREE.Mesh(uranusRingGeo,uranusRingMat);
    this.uranusRing.rotation.z=Math.PI/2.15;
    this.scene.add(this.uranusRing);

    // Cometa Halley: nucleo brillante (a esta escala no se ve tamaño real, es un marcador)
    const halleyMat=new THREE.MeshBasicMaterial({color:0xddeeff});
    this.bodyMeshes.halley=new THREE.Mesh(new THREE.SphereGeometry(5000000,12,12),halleyMat);
    this.scene.add(this.bodyMeshes.halley);

    // Plataforma de acoplamiento (demo): cuerpo cilindrico + panel solar + anillo del puerto
    this.dockingTargetGroup=new THREE.Group();
    const dtBody=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,4,16),new THREE.MeshStandardMaterial({color:0xaaaaaa,metalness:0.7,roughness:0.4}));
    this.dockingTargetGroup.add(dtBody);
    const panelMat=new THREE.MeshStandardMaterial({color:0x2244aa,metalness:0.3,roughness:0.6,side:THREE.DoubleSide});
    const panelL=new THREE.Mesh(new THREE.BoxGeometry(8,0.1,3),panelMat); panelL.position.x=-5.5;
    const panelR=new THREE.Mesh(new THREE.BoxGeometry(8,0.1,3),panelMat); panelR.position.x=5.5;
    this.dockingTargetGroup.add(panelL); this.dockingTargetGroup.add(panelR);
    const portRing=new THREE.Mesh(new THREE.TorusGeometry(1.6,0.15,8,20),new THREE.MeshBasicMaterial({color:0x00ff88}));
    portRing.rotation.x=Math.PI/2; portRing.position.y=2.2;
    this.dockingTargetGroup.add(portRing);
    this.scene.add(this.dockingTargetGroup);

    // Cinturon de Kuiper: anillo de particulas decorativo entre ~35 y ~48 UA
    const kCount=3000;
    const kGeo=new THREE.BufferGeometry();
    const kPos=new Float32Array(kCount*3);
    for (let i=0;i<kCount;i++){
      const ang=Math.random()*Math.PI*2;
      const r=(35+Math.random()*13)*AU;
      const h=(Math.random()-0.5)*2*AU;
      kPos[i*3]=Math.cos(ang)*r; kPos[i*3+1]=h; kPos[i*3+2]=Math.sin(ang)*r;
    }
    kGeo.setAttribute('position',new THREE.BufferAttribute(kPos,3));
    this.kuiperBelt=new THREE.Points(kGeo,new THREE.PointsMaterial({color:0x8a7860,size:2500000,transparent:true,opacity:0.75}));
    this.scene.add(this.kuiperBelt);
  }
  buildRocket(){
    while (this.rocketGroup.children.length) this.rocketGroup.remove(this.rocketGroup.children[0]);
    this.flameMeshes=[];
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin'){ this.buildVostok(); return; }
    // Modelo puramente visual (un solo cuerpo rigido, sin separacion de etapas real -- la fisica
    // sigue siendo la de un unico deposito/motor, ya validada). Tres segmentos diferenciados
    // imitan las proporciones del Saturno V real (S-IC ancho en la base, S-II y S-IVB mas
    // estrechos), con interetapas, franjas negras de seguimiento, CSM y patas del modulo lunar.
    const bodyMat=new THREE.MeshStandardMaterial({color:0xf2f0e6,roughness:0.4,metalness:0.15});
    const stripeMat=new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:0.5,metalness:0.1});
    const interstageMat=new THREE.MeshStandardMaterial({color:0x9a9aa2,roughness:0.3,metalness:0.7});
    const capsuleMat=new THREE.MeshStandardMaterial({color:0xd8d4c0,roughness:0.35,metalness:0.3});
    const windowMat=new THREE.MeshStandardMaterial({color:0x1a2a33,roughness:0.05,metalness:0.9,emissive:0x2288ff,emissiveIntensity:0.3,transparent:true,opacity:0.85});
    const legMat=new THREE.MeshStandardMaterial({color:0xc9a15a,roughness:0.5,metalness:0.6}); // dorado, aislante termico del modulo lunar
    const engineMat=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.2,metalness:0.9});

    // ---- S-IC (1ª etapa, la mas ancha, en la base) ----
    this.sICGroup = new THREE.Group();
    const sIC=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.6,2.6,24),bodyMat);
    sIC.position.y=1.3; sIC.castShadow=true; this.sICGroup.add(sIC);
    const stripeIC=new THREE.Mesh(new THREE.CylinderGeometry(1.46,1.46,0.22,24),stripeMat);
    stripeIC.position.y=2.2; this.sICGroup.add(stripeIC);

    // ---- Interetapa S-IC/S-II (se va con la S-IC) ----
    const inter1=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.45,0.35,24),interstageMat);
    inter1.position.y=2.775; this.sICGroup.add(inter1);
    this.rocketGroup.add(this.sICGroup);

    // ---- S-II (2ª etapa, mas estrecha) ----
    this.sIIGroup = new THREE.Group();
    const sII=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.4,1.9,24),bodyMat);
    sII.position.y=3.9; sII.castShadow=true; this.sIIGroup.add(sII);
    const stripeII=new THREE.Mesh(new THREE.CylinderGeometry(1.26,1.26,0.2,24),stripeMat);
    stripeII.position.y=4.6; this.sIIGroup.add(stripeII);
    const inter2=new THREE.Mesh(new THREE.CylinderGeometry(0.95,1.25,0.3,24),interstageMat);
    inter2.position.y=5.0; this.sIIGroup.add(inter2);
    this.rocketGroup.add(this.sIIGroup);

    // ---- S-IVB (3ª etapa, la mas estrecha, la que hace la quema translunar) ----
    this.sIVBGroup = new THREE.Group();
    const sIVB=new THREE.Mesh(new THREE.CylinderGeometry(0.85,0.95,1.4,24),bodyMat);
    sIVB.position.y=5.85; sIVB.castShadow=true; this.sIVBGroup.add(sIVB);
    const stripeIVB=new THREE.Mesh(new THREE.CylinderGeometry(0.86,0.86,0.16,24),stripeMat);
    stripeIVB.position.y=6.35; this.sIVBGroup.add(stripeIVB);
    this.rocketGroup.add(this.sIVBGroup);

    // ---- Modulo de mando: capsula troncoconica roma ----
    const capsule=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.85,1.3,24),capsuleMat);
    capsule.position.y=7.15; capsule.castShadow=true; this.rocketGroup.add(capsule);
    const capsuleTop=new THREE.Mesh(new THREE.ConeGeometry(0.5,0.75,24),capsuleMat);
    capsuleTop.position.y=8.18; capsuleTop.castShadow=true; this.rocketGroup.add(capsuleTop);

    // ---- Torre de escape ----
    const towerMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:0.4,metalness:0.7});
    const tower=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.07,1.2,8),towerMat);
    tower.position.y=9.15; this.rocketGroup.add(tower);
    const towerTip=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.35,8),towerMat);
    towerTip.position.y=9.9; this.rocketGroup.add(towerTip);

    // ---- Ventanas pequeñas y redondas del modulo de mando ----
    for (let i=0;i<2;i++){
      const windowMesh=new THREE.Mesh(new THREE.CircleGeometry(0.14,16),windowMat);
      const angle=(i/2)*Math.PI*2+0.4;
      windowMesh.position.set(0.7*Math.cos(angle),6.95,0.7*Math.sin(angle));
      windowMesh.lookAt(windowMesh.position.x*2,6.95,windowMesh.position.z*2);
      this.rocketGroup.add(windowMesh);
    }

    // ---- Patas tipo modulo lunar: ocultas al principio (van dentro del SLA, entre la S-IVB
    // y el modulo de mando, como en el Apolo 11 real) -- se muestran al llegar a la Luna ----
    this.lmLegsGroup = new THREE.Group();
    this.lmLegsGroup.visible = false;
    for (let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2+Math.PI/4;
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.5,8),legMat);
      leg.position.set(1.55*Math.cos(angle),-0.25,1.55*Math.sin(angle));
      leg.rotation.z=Math.cos(angle)*0.5; leg.rotation.x=Math.sin(angle)*0.5;
      leg.castShadow=true; this.lmLegsGroup.add(leg);
      const footpad=new THREE.Mesh(new THREE.SphereGeometry(0.17,8,8),legMat);
      footpad.position.set(2.2*Math.cos(angle),-0.95,2.2*Math.sin(angle));
      this.lmLegsGroup.add(footpad);
    }
    this.rocketGroup.add(this.lmLegsGroup);

    // ---- 5 toberas F-1 en la base (solo visual, un unico motor fisico real) ----
    for (let i=0;i<5;i++){
      const angle=(i/5)*Math.PI*2;
      const r=i===0?0:0.7;
      const f1=new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.38,0.55,16),engineMat);
      f1.position.set(r*Math.cos(angle),-0.15,r*Math.sin(angle)); this.rocketGroup.add(f1);
    }
    const nozzleMat=new THREE.MeshStandardMaterial({color:0x222233,roughness:0.15,metalness:0.98,emissive:0x331100,emissiveIntensity:0.1});
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.1,0.4,24),nozzleMat);
    nozzle.position.y=-0.5; this.rocketGroup.add(nozzle);

    const glowMat=new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending});
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.7,12,12),glowMat);
    glow.position.y=-0.6; this.rocketGroup.add(glow); this.engineGlow=glow;
  }

  // Modelo de la Vostok 1: esfera de descenso + modulo de instrumentos conico + paracaidas.
  // Forma real y distinta del Saturno V -- no reutiliza el modelo de Apolo.
  buildVostok(){
    const hullMat=new THREE.MeshStandardMaterial({color:0xd8d8d0,roughness:0.4,metalness:0.5});
    const darkMat=new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:0.5,metalness:0.3});
    const engineMat=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.2,metalness:0.9});
    const chuteMat=new THREE.MeshStandardMaterial({color:0xffa040,roughness:0.8,metalness:0.0,side:THREE.DoubleSide});
    const lineMat=new THREE.LineBasicMaterial({color:0xcccccc});

    // ---- Modulo de instrumentos: tronco de cono, se desprende antes de la reentrada ----
    this.vostokEquipGroup = new THREE.Group();
    const equip=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.95,1.6,20),darkMat);
    equip.position.y=0.6; equip.castShadow=true; this.vostokEquipGroup.add(equip);
    this.rocketGroup.add(this.vostokEquipGroup);

    // 5 toberas del R-7 (solo visual, un unico motor fisico real)
    for (let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2;
      const eng=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.24,0.4,14),engineMat);
      eng.position.set(0.55*Math.cos(angle),-0.35,0.55*Math.sin(angle)); this.vostokEquipGroup.add(eng);
    }
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.5,0.35,20),engineMat);
    nozzle.position.y=-0.4; this.vostokEquipGroup.add(nozzle);
    const glowMat=new THREE.MeshBasicMaterial({color:0xff5500,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending});
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.4,12,12),glowMat);
    glow.position.y=-0.55; this.vostokEquipGroup.add(glow); this.engineGlow=glow;

    // ---- Esfera de descenso: la capsula real, siempre visible ----
    this.vostokSphere = new THREE.Mesh(new THREE.SphereGeometry(0.95,24,24),hullMat);
    this.vostokSphere.position.y=2.0; this.vostokSphere.castShadow=true; this.rocketGroup.add(this.vostokSphere);
    // 3 ventanillas pequeñas y redondas
    const windowMat=new THREE.MeshStandardMaterial({color:0x1a2a33,roughness:0.05,metalness:0.9,emissive:0x2288ff,emissiveIntensity:0.25,transparent:true,opacity:0.85});
    for (let i=0;i<3;i++){
      const angle=(i/3)*Math.PI*2;
      const w=new THREE.Mesh(new THREE.CircleGeometry(0.13,16),windowMat);
      w.position.set(0.9*Math.cos(angle),2.0,0.9*Math.sin(angle));
      w.lookAt(w.position.x*2,2.0,w.position.z*2); this.rocketGroup.add(w);
    }

    // ---- Paracaidas: oculto hasta la fase de descenso final ----
    this.parachuteGroup = new THREE.Group();
    this.parachuteGroup.visible=false;
    const canopy=new THREE.Mesh(new THREE.ConeGeometry(2.2,2.6,16,1,true),chuteMat);
    canopy.position.y=6.2; canopy.rotation.x=Math.PI; this.parachuteGroup.add(canopy);
    for (let i=0;i<8;i++){
      const angle=(i/8)*Math.PI*2;
      const pts=[new THREE.Vector3(2.1*Math.cos(angle),5.0,2.1*Math.sin(angle)), new THREE.Vector3(0,2.6,0)];
      const lineGeo=new THREE.BufferGeometry().setFromPoints(pts);
      this.parachuteGroup.add(new THREE.Line(lineGeo,lineMat));
    }
    this.rocketGroup.add(this.parachuteGroup);
  }

  // Visibilidad de las partes de la Vostok segun la fase: modulo de instrumentos visible
  // hasta el retrofrenado (se desprende antes de la reentrada, como en la mision real);
  // paracaidas visible solo en el tramo final del descenso.
  updateVostokVisibility(missionPhase){
    const hasEquip = !['gagarin_descent','gagarin_parachute','done'].includes(missionPhase);
    const hasChute = missionPhase==='gagarin_parachute';
    if (this.vostokEquipGroup) this.vostokEquipGroup.visible = hasEquip;
    if (this.parachuteGroup) this.parachuteGroup.visible = hasChute;
  }

  // Separacion visual de etapas, atada a las FASES del piloto automatico (no al reloj real):
  // nuestra simulacion no tarda lo mismo que la mision real (el TLI dispara mucho antes que
  // las 2h44m reales), asi que usar los tiempos historicos (162s/522s/702s) haria que una
  // etapa "cayera" en mitad del crucero translunar. Puramente decorativo -- no toca la fisica.
  updateStageVisibility(missionPhase){
    if (!missionPhase){ // sandbox sin piloto automatico: cohete completo, como siempre
      this.sICGroup.visible=true; this.sIIGroup.visible=true; this.sIVBGroup.visible=true; this.lmLegsGroup.visible=false;
      return;
    }
    const leftEarthOrbit = !['ascent'].includes(missionPhase);
    const arrivedAtMoon = ['loi_burn','descent','done'].includes(missionPhase);
    this.sICGroup.visible = !leftEarthOrbit;
    this.sIIGroup.visible = !leftEarthOrbit;
    this.sIVBGroup.visible = leftEarthOrbit && !arrivedAtMoon;
    this.lmLegsGroup.visible = arrivedAtMoon;
  }
  setupMiniViews(){
    this.frontCam=new THREE.PerspectiveCamera(60,150/110,0.5,9000000000000);
    this.backCam=new THREE.PerspectiveCamera(60,150/110,0.5,9000000000000);
    const fEl=document.getElementById('mvFront'), bEl=document.getElementById('mvBack');
    this.frontRenderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
    this.backRenderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
    this.frontRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.backRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    fEl.appendChild(this.frontRenderer.domElement);
    bEl.appendChild(this.backRenderer.domElement);
    this.resizeMiniViews();
  }
  resizeMiniViews(){
    const fEl=document.getElementById('mvFront'), bEl=document.getElementById('mvBack');
    const fw=fEl.clientWidth, fh=fEl.clientHeight;
    const bw=bEl.clientWidth, bh=bEl.clientHeight;
    this.frontRenderer.setSize(fw,fh); this.frontCam.aspect=fw/fh; this.frontCam.updateProjectionMatrix();
    this.backRenderer.setSize(bw,bh); this.backCam.aspect=bw/bh; this.backCam.updateProjectionMatrix();
  }
  updateFlame(throttle){
    const MAX_FLAMES=24;
    if (!this._flamePool){
      this._flamePool=[];
      const unitCone=new THREE.ConeGeometry(1,1,6);
      for (let i=0;i<MAX_FLAMES;i++){
        const mat=new THREE.MeshBasicMaterial({transparent:true,blending:THREE.AdditiveBlending});
        const mesh=new THREE.Mesh(unitCone,mat);
        mesh.visible=false;
        this.rocketGroup.add(mesh);
        this._flamePool.push(mesh);
      }
    }
    if (throttle<0.05){
      this._flamePool.forEach(m=>m.visible=false);
      return;
    }
    const count=Math.floor(3+throttle*8);
    let idx=0;
    for (let i=0;i<count && idx<MAX_FLAMES;i++){
      const len=1+throttle*6+Math.random()*2, width=0.2+throttle*0.8+Math.random()*0.3, angle=(Math.random()-0.5)*0.3;
      const color=new THREE.Color().setHSL(0.05+Math.random()*0.05,1,0.4+Math.random()*0.4);
      const opacity=0.6+Math.random()*0.3;

      const flame=this._flamePool[idx++];
      flame.visible=true; flame.scale.set(width,len,width);
      flame.position.set(Math.sin(angle)*0.3,-0.8-len/2,Math.cos(angle)*0.3);
      flame.rotation.x=angle*0.5; flame.rotation.z=angle*0.3;
      flame.material.color.copy(color); flame.material.opacity=opacity;

      if (Math.random()>0.5 && idx<MAX_FLAMES){
        const sub=this._flamePool[idx++];
        sub.visible=true; sub.scale.set(width*0.5,len*0.6,width*0.5);
        sub.position.set(Math.sin(angle+0.2)*0.5,-0.8-len*0.4,Math.cos(angle+0.2)*0.5);
        sub.rotation.x=0; sub.rotation.z=0;
        sub.material.color.copy(color); sub.material.opacity=opacity;
      }
    }
    for (let i=idx;i<MAX_FLAMES;i++) this._flamePool[i].visible=false;
  }
  update(state, frameDt, missionPhase){
    const isGagarin = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
    if (isGagarin) this.updateVostokVisibility(missionPhase);
    else this.updateStageVisibility(missionPhase);
    const shipAbs = new THREE.Vector3(state.shipAbs.x, state.shipAbs.y, state.shipAbs.z);
    // origen flotante: cada cuerpo se coloca en su posicion real MENOS la posicion real de la nave,
    // asi la nave siempre esta cerca de (0,0,0) sin importar si estamos junto a la Tierra o cerca de Pluton.
    for (const name in this.bodyMeshes){
      const bp = state.bodies[name];
      if (!bp) continue;
      this.bodyMeshes[name].position.set(bp.x-shipAbs.x, bp.y-shipAbs.y, bp.z-shipAbs.z);
    }
    if (this.clouds) this.clouds.position.copy(this.earth.position);
    if (this.atmosphere) this.atmosphere.position.copy(this.earth.position);
    if (this.baikonurMarker && state.bodies.earth){
      const ep=state.bodies.earth;
      this.baikonurMarker.position.set(ep.x+this.baikonurOffset.x-shipAbs.x, ep.y+this.baikonurOffset.y-shipAbs.y, ep.z+this.baikonurOffset.z-shipAbs.z);
    }
    if (this.smelovkaMarker && state.bodies.earth){
      const ep=state.bodies.earth;
      this.smelovkaMarker.position.set(ep.x+this.smelovkaOffset.x-shipAbs.x, ep.y+this.smelovkaOffset.y-shipAbs.y, ep.z+this.smelovkaOffset.z-shipAbs.z);
    }
    if (this.saturnRing) this.saturnRing.position.copy(this.bodyMeshes.saturn.position);
    if (this.uranusRing) this.uranusRing.position.copy(this.bodyMeshes.uranus.position);
    if (this.kuiperBelt) this.kuiperBelt.position.set(-shipAbs.x,-shipAbs.y,-shipAbs.z);

    if (this.dockingTargetGroup && DOCKING_TARGETS[0]){
      const dt=DOCKING_TARGETS[0];
      const ts=dockingTargetState(dt, state.time);
      const parentAbs=state.bodies[dt.parent];
      this.dockingTargetGroup.position.set(
        parentAbs.x+ts.pos.x-shipAbs.x, parentAbs.y+ts.pos.y-shipAbs.y, parentAbs.z+ts.pos.z-shipAbs.z
      );
    }

    if (this.earth) this.earth.rotation.y = (state.time/EARTH_SIDEREAL_DAY)*Math.PI*2;
    if (this.clouds) this.clouds.rotation.y = (state.time/(EARTH_SIDEREAL_DAY*0.9))*Math.PI*2;
    if (this.moon) this.moon.rotation.y += frameDt*(Math.PI*2/300);
    if (this.bodyMeshes.jupiter) this.bodyMeshes.jupiter.rotation.y = (state.time/35730)*Math.PI*2; // 9h 55m 30s real
    if (this.bodyMeshes.saturn) this.bodyMeshes.saturn.rotation.y = (state.time/38018)*Math.PI*2; // 10h 33m 38s real
    if (this.atmosphere) this.atmosphere.visible = (state.body==='earth');

    // el suelo/rejilla local solo tienen sentido cerca de una superficie: ocultarlos si estamos lejos
    const nearAnySurface = state.altitude < 20000;
    if (this.ground) this.ground.visible = nearAnySurface;
    if (this.grid) this.grid.visible = nearAnySurface;

    if (this.stars){
      this.stars.position.set(0,0,0);
      this.starClock += frameDt;
      this.stars.material.opacity = 0.75 + Math.sin(this.starClock*2.3)*0.08 + Math.sin(this.starClock*5.1)*0.05;
    }

    // la nave SIEMPRE se dibuja en el origen local (con el pequeño temblor de la sacudida)
    this.rocketGroup.position.set(0,0,0);
    this.rocketGroup.rotation.order='YXZ';
    this.rocketGroup.rotation.y=state.yaw; this.rocketGroup.rotation.x=state.pitch; this.rocketGroup.rotation.z=state.roll;

    const shake=(state.shakeIntensity||0) + (state.reentry ? 0.4+Math.random()*0.3 : 0);
    this.rocketGroup.position.x+=(Math.random()-0.5)*shake*0.3;
    this.rocketGroup.position.y+=(Math.random()-0.5)*shake*0.3;
    this.rocketGroup.position.z+=(Math.random()-0.5)*shake*0.3;

    if (this.engineGlow){
      const intensity=state.throttle*0.8+0.2;
      this.engineGlow.material.opacity=intensity*0.6;
      this.engineGlow.scale.setScalar(1+state.throttle*0.8);
    }
    if (this.engineLight){
      this.engineLight.intensity=state.throttle*5;
      this.engineLight.position.set(Math.sin(state.pitch)*2,-3,0);
    }
    this.updateFlame(state.throttle);
    this.updateParticles(state);
    this.updateTrail(state, shipAbs);

    this.bloomPass.strength=0.2+state.throttle*0.6+(state.hyperspace?0.5:0)+(state.warp?0.3:0)+(state.reentry?0.7:0);

    const cockpitOverlay=document.getElementById('cockpitOverlay');
    if (cockpitOverlay) cockpitOverlay.classList.toggle('active', !!state.reentry && this.viewMode==='cockpit');

    const shipPos=new THREE.Vector3(0,0,0);
    const heading=new THREE.Vector3(0,1,0).applyEuler(new THREE.Euler(state.pitch,state.yaw,state.roll,'YXZ'));

    if (this.viewMode==='cockpit'){
      this.rocketGroup.visible=false;
      const pos=shipPos.clone().addScaledVector(heading,4);
      const target=shipPos.clone().addScaledVector(heading,60);
      const camShake=shake*0.5;
      pos.x+=(Math.random()-0.5)*camShake; pos.y+=(Math.random()-0.5)*camShake*0.5;
      this.camera.position.lerp(pos,0.15);
      this.camera.lookAt(target);
      document.getElementById('shakeOverlay').className='shake-overlay'+(shake>0.1?' active':'');
      const vzorDisc=document.getElementById('vzorDisc');
      if (vzorDisc){
        const showVzor = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
        vzorDisc.classList.toggle('active', showVzor);
        if (showVzor){
          // Vzor real: proyectaba el horizonte para juzgar la orientacion. Aqui, nivel (horizonte
          // centrado) = morro apuntando a la horizontal local (pitch=90 grados en este motor,
          // porque pitch=0 significa "hacia el cenit" desde el lanzamiento); el alabeo inclina
          // la linea de horizonte, como el desplazamiento que Gagarin observaba de verdad.
          const angleFromLevel = state.pitch - Math.PI/2;
          const horizon=document.getElementById('vzorHorizon');
          if (horizon) horizon.style.transform = 'rotate('+(-state.roll)+'rad) translateY('+(angleFromLevel*90).toFixed(1)+'px)';
        }
      }
    } else {
      this.rocketGroup.visible=true;
      let followTarget = shipPos.clone().addScaledVector(heading,4);
      if (this.focusTarget && this.bodyMeshes[this.focusTarget]){
        followTarget = this.bodyMeshes[this.focusTarget].position.clone();
      }
      this.controls.target.lerp(followTarget,0.3); this.controls.update();
      document.getElementById('shakeOverlay').className='shake-overlay';
      const vzorDiscExt=document.getElementById('vzorDisc');
      if (vzorDiscExt) vzorDiscExt.classList.remove('active');
    }
    this.composer.render();

    this.rocketGroup.visible=true;
    const earthPos = this.earth ? this.earth.position : new THREE.Vector3(0,-this.R_earth,0);
    const moonPos = this.moon ? this.moon.position : new THREE.Vector3(1800000,2600000,-1200000);
    const frontPos=shipPos.clone().addScaledVector(heading,6);
    this.frontCam.position.copy(frontPos); this.frontCam.lookAt(earthPos);
    this.frontRenderer.render(this.scene,this.frontCam);

    const backPos=shipPos.clone().addScaledVector(heading,-6);
    this.backCam.position.copy(backPos); this.backCam.lookAt(moonPos);
    this.backRenderer.render(this.scene,this.backCam);

    const fData=document.getElementById('mvFrontData'), bData=document.getElementById('mvBackData');
    const distToEarthSurface = shipPos.distanceTo(earthPos) - this.R_earth;
    const distToMoon = shipPos.distanceTo(moonPos);
    if (fData) fData.textContent = formatDistance(Math.max(0,distToEarthSurface));
    if (bData) bData.textContent = formatDistance(distToMoon);
  }
  updateParticles(state){
    const particles=state.particles||[]; const count=particles.length;
    const MAX_P=2000;
    if (!this._pBuf){
      this._pBuf={
        pos:new Float32Array(MAX_P*3), col:new Float32Array(MAX_P*3), size:new Float32Array(MAX_P)
      };
      this.particleSystem.setAttribute('position',new THREE.BufferAttribute(this._pBuf.pos,3));
      this.particleSystem.setAttribute('color',new THREE.BufferAttribute(this._pBuf.col,3));
      this.particleSystem.setAttribute('size',new THREE.BufferAttribute(this._pBuf.size,1));
    }
    if (count===0){ this.particlePoints.visible=false; return; }
    this.particlePoints.visible=true;
    const n=Math.min(count,MAX_P);
    const {pos,col,size}=this._pBuf;
    for (let i=0;i<n;i++){
      const p=particles[i];
      pos[i*3]=p.x-state.x; pos[i*3+1]=p.y-state.y; pos[i*3+2]=p.z-state.z;
      const lifeRatio=p.life/p.maxLife; const color=p.color||[1,0.5,0.1];
      col[i*3]=color[0]*lifeRatio; col[i*3+1]=color[1]*lifeRatio*0.8; col[i*3+2]=color[2]*lifeRatio*0.5;
      size[i]=p.size*lifeRatio;
    }
    this.particleSystem.attributes.position.needsUpdate=true;
    this.particleSystem.attributes.color.needsUpdate=true;
    this.particleSystem.attributes.size.needsUpdate=true;
    this.particleSystem.setDrawRange(0,n);
  }
  updateTrail(state, shipAbs){
    const trail=state.trail||[];
    if (!this.trailLine){
      this.trailPositions=new Float32Array(400*3);
      this.trailGeometry=new THREE.BufferGeometry();
      this.trailGeometry.setAttribute('position',new THREE.BufferAttribute(this.trailPositions,3));
      this.trailMaterial=new THREE.LineBasicMaterial({color:0xff6633,transparent:true,opacity:0.2});
      this.trailLine=new THREE.Line(this.trailGeometry,this.trailMaterial);
      this.scene.add(this.trailLine);
    }
    if (trail.length<2){ this.trailLine.visible=false; return; }
    this.trailLine.visible=true;
    const n=Math.min(trail.length,400);
    for (let i=0;i<n;i++){
      this.trailPositions[i*3]=trail[i].x-shipAbs.x;
      this.trailPositions[i*3+1]=trail[i].y-shipAbs.y;
      this.trailPositions[i*3+2]=trail[i].z-shipAbs.z;
    }
    this.trailGeometry.attributes.position.needsUpdate=true;
    this.trailGeometry.setDrawRange(0,n);
    this.trailGeometry.computeBoundingSphere();
  }
  toggleView(){
    this.viewMode=this.viewMode==='external'?'cockpit':'external';
    if (this.viewMode==='cockpit'){ this.controls.enabled=false; this.camera.fov=65; }
    else { this.controls.enabled=true; this.camera.fov=55; }
    this.camera.updateProjectionMatrix();
    return this.viewMode;
  }
  setFocus(target){ this.focusTarget = target; }
  resize(){
    const width=this.container.clientWidth, height=this.container.clientHeight;
    this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height); this.composer.setSize(width,height);
    this.resizeMiniViews();
  }
}

/* ---------- PILOTO AUTOMATICO DE MISION COMPLETA ---------- */
// Portado y adaptado del algoritmo probado de extremo a extremo por separado: despegue con giro
// gravitatorio real -> orbita -> inyeccion translunar (vis-viva) -> crucero con correcciones de
// rumbo -> caida controlada y insercion en orbita lunar baja -> descenso en dos fases (frenada
// horizontal con direccion FIJA + control fino final) -> alunizaje suave.
// Cada quema usa una direccion CALCULADA UNA VEZ (no recalculada cada fotograma): con un motor
// tan potente, perseguir un objetivo que cambia de instante a instante nunca converge a tiempo.
function cross3fix(radial){
  const arbitrary = Math.abs(radial.x)<0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
  return cross3(radial, arbitrary);
}
class MissionAutopilot {
  constructor(app){
    this.app = app;
    this.active = false;
    this.phase = null;
    this.phaseStart = 0;
    this.lastExplainPhase = null;
    this.lastCorrection = -1e9;
    this._targetedOnce = false;
    this._loiSub = undefined;
    this._descSub = undefined;
    this._fixedDeorbitDir = null;
    this._numBurns = 1;
    this.paused = false;
    this.speed = 1;
  }
  start(){
    this.active = true;
    this.paused = false;
    this.speed = 1;
    const isGagarin = this.app.mission && this.app.mission.type==='gagarin';
    this.phase = isGagarin ? 'gagarin_ascent' : 'ascent';
    this.phaseStart = this.app.physics.time;
    this._targetedOnce = false; this._loiSub = undefined; this._descSub = undefined;
    this._fixedDeorbitDir = null; this._numBurns = 1; this.lastExplainPhase = null;
    this.explain(this.phase);
  }
  stop(msg){
    this.active = false;
    if (msg) this.app.toast.show(msg, 6000);
  }
  explain(key){
    if (this.lastExplainPhase===key) return;
    this.lastExplainPhase = key;
    const isGagarin = this.app.mission && this.app.mission.type==='gagarin';
    const MSG = {
      ascent: '🚀 Piloto automático: despegando con giro gravitatorio real hacia el este.',
      coast_leo: '🛰️ En órbita terrestre. Preparando la inyección translunar.',
      tli_burn: '🔥 Quemando prógrado para alcanzar la velocidad exacta hacia la Luna (ecuación vis-viva).',
      coast_tli: '🌌 Crucero hacia la Luna, con correcciones de rumbo automáticas cada 6h simuladas.',
      loi_burn: '🌑 Aproximación lunar: cayendo con seguridad hacia una órbita baja real.',
      descent: '🛬 Descenso motorizado hacia la superficie.',
      done: isGagarin ? null : '🎉 ¡Alunizaje automático logrado!'
    };
    if (MSG[key]) this.app.toast.show(MSG[key], 7000);
  }
  statusLabel(){
    const NAMES = {
      ascent:'Ascenso', coast_leo:'Órbita terrestre', tli_burn:'Quema translunar',
      coast_tli:'Crucero a la Luna', loi_burn:'Aproximación lunar', descent:'Descenso', done:'Completado'
    };
    return NAMES[this.phase] || this.phase;
  }
  // Devuelve el objeto de controles a aplicar este fotograma, o null si el piloto no esta activo.
  step(){
    if (!this.active) return null;
    const p = this.app.physics;
    if (p.stack.justSeparated){
      this.app.toast.show('💥 Separación de etapa: '+p.stack.justSeparated+' descartada.', 4000);
      p.stack.justSeparated=null;
    }
    const preState = p.getState();
    const speedNow = Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
    const controls = {throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:1};

    // ---- MISION GAGARIN (Vostok 1): ascenso -> coast a apoastro -> circularizacion real ----
    // -> una vuelta orbital -> retrofrenado -> reentrada (la resistencia atmosferica ya
    // existente hace de escudo termico) -> paracaidas -> aterrizaje. Probado de extremo a
    // extremo en Node antes de escribir esto (perigeo real positivo confirmado, no solo calculado).
    if (this.phase==='gagarin_ascent'){
      this.explain('gagarin_ascent');
      const tAsc = p.time - this.phaseStart;
      let dir;
      if (tAsc<8) dir = FRAME_ROTATION({x:0,y:1,z:0});
      else { const angle=Math.min(1.45,0.02*(tAsc-8)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=1; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      if (speedNow>=vCirc*1.02 && preState.altitude>80000){
        this.phase='gagarin_coast_apo'; this.phaseStart=p.time; this.explain('gagarin_coast_apo');
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible antes de alcanzar la órbita.'); return null; }
      return controls;
    }

    if (this.phase==='gagarin_coast_apo'){
      this.explain('gagarin_coast_apo');
      controls.throttle=0; controls.timeScale=20;
      const rHat=norm3({x:p.x,y:p.y,z:p.z});
      const vRad=p.u*rHat.x+p.v*rHat.y+p.w*rHat.z;
      if (vRad<=0){ this.phase='gagarin_circularize'; this.phaseStart=p.time; this.explain('gagarin_circularize'); }
      return controls;
    }

    if (this.phase==='gagarin_circularize'){
      this.explain('gagarin_circularize');
      const dir = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      controls.throttle = speedNow<vCirc ? 1 : 0;
      // Perigeo real (no una foto instantanea de "inOrbit"): calculado con los elementos orbitales
      const mu=G*SOLAR_BODIES.earth.mass;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const vxh_x=p.v*hz-p.w*hy, vxh_y=p.w*hx-p.u*hz, vxh_z=p.u*hy-p.v*hx;
      const ex=vxh_x/mu-p.x/rMag, ey=vxh_y/mu-p.y/rMag, ez=vxh_z/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez);
      const a=1/(2/rMag-speedNow*speedNow/mu);
      const r_p = (isFinite(a)&&a>0) ? a*(1-eMag) : -1;
      if (r_p>0 && (r_p-SOLAR_BODIES.earth.radius)>140000){
        this.phase='gagarin_orbit'; this.phaseStart=p.time; this.explain('gagarin_orbit');
        this.app.toast.show('🛰️ Órbita real alcanzada — perigeo '+((r_p-SOLAR_BODIES.earth.radius)/1000).toFixed(0)+'km', 6000);
      }
      if (speedNow>=vCirc*1.06){ this.stop('⚠️ Circularización fallida — velocidad excesiva.'); return null; }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la circularización.'); return null; }
      return controls;
    }

    if (this.phase==='gagarin_orbit'){
      this.explain('gagarin_orbit');
      const dir = norm3({x:p.u,y:p.v,z:p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0; controls.timeScale=200;
      // Una vuelta real (el periodo depende de la orbita conseguida; 108 min de la mision real
      // de Gagarin de polo a polo, aqui se deja correr un tiempo generoso y fijo en su lugar)
      if (p.time-this.phaseStart>6000){
        this.phase='gagarin_retro'; this.phaseStart=p.time; this.explain('gagarin_retro');
      }
      return controls;
    }

    if (this.phase==='gagarin_retro'){
      this.explain('gagarin_retro');
      const dir = norm3({x:-p.u,y:-p.v,z:-p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0.35; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z);
      const mu=G*SOLAR_BODIES.earth.mass;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const vxh_x=p.v*hz-p.w*hy, vxh_y=p.w*hx-p.u*hz, vxh_z=p.u*hy-p.v*hx;
      const ex=vxh_x/mu-p.x/rMag, ey=vxh_y/mu-p.y/rMag, ez=vxh_z/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez);
      const a=1/(2/rMag-speedNow*speedNow/mu);
      const r_p = (isFinite(a)&&a>0) ? a*(1-eMag) : -1;
      if ((r_p>0 && (r_p-SOLAR_BODIES.earth.radius)<50000) || (p.time-this.phaseStart)>50){
        this.phase='gagarin_descent'; this.phaseStart=p.time; this.explain('gagarin_descent');
        this.app.toast.show('🔥 Retrocohetes encendidos — reentrada en curso.', 6000);
      }
      return controls;
    }

    if (this.phase==='gagarin_descent'){
      this.explain('gagarin_descent');
      controls.throttle=0; controls.timeScale = preState.altitude>7000 ? 5 : 1;
      if (preState.altitude<=7000 && preState.altitude>0){
        this.phase='gagarin_parachute'; this.phaseStart=p.time; this.explain('gagarin_parachute');
        this.app.toast.show('🪂 Paracaídas desplegado a 7km de altitud.', 6000);
      }
      return controls;
    }

    if (this.phase==='gagarin_parachute'){
      this.explain('gagarin_parachute');
      controls.throttle=0; controls.timeScale=1;
      // Frenada del paracaidas: ayuda simplificada (decaimiento exponencial de la velocidad
      // vertical), igual de declarada que el freno horizontal del descenso lunar del Apolo.
      const decay = Math.pow(0.15, 1/60);
      p.u*=decay; p.v*=decay; p.w*=decay;
      if (preState.altitude<=0){
        this.phase='done'; this.explain('done');
        this.app.toast.show('🎉 "¡Poyejali!" — Gagarin aterriza sano y salvo cerca de Smelovka.', 8000);
      }
      return controls;
    }

    if (this.phase==='ascent'){
      this.explain('ascent');
      const tAsc = p.time - this.phaseStart;
      let dir;
      if (tAsc<8) dir = FRAME_ROTATION({x:0,y:1,z:0});
      else { const angle=Math.min(1.45,0.02*(tAsc-8)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=1; controls.timeScale=1;
      if (preState.inOrbit){ this.phase='coast_leo'; this.phaseStart=p.time; this.explain('coast_leo'); }
      if (preState.fuelPercent<=0 && !preState.inOrbit){ this.stop('⚠️ Sin combustible antes de alcanzar órbita.'); return null; }
      return controls;
    }

    if (this.phase==='coast_leo'){
      this.explain('coast_leo');
      const dir = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0; controls.timeScale=10;
      if (p.time-this.phaseStart>60){
        const rNow=SOLAR_BODIES.earth.radius+preState.altitude, rApo=SOLAR_BODIES.moon.a;
        const a=(rNow+rApo)/2, GM=G*SOLAR_BODIES.earth.mass;
        this.targetSpeedTLI=Math.sqrt(GM*(2/rNow-1/a));
        this.phase='tli_burn'; this.phaseStart=p.time; this.explain('tli_burn');
      }
      return controls;
    }

    if (this.phase==='tli_burn'){
      this.explain('tli_burn');
      const dir=norm3({x:p.u,y:p.v,z:p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll;
      controls.throttle = speedNow<this.targetSpeedTLI ? 1 : 0; controls.timeScale=1;
      if (speedNow>=this.targetSpeedTLI){ this.phase='coast_tli'; this.phaseStart=p.time; this.explain('coast_tli'); }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la inyección translunar.'); return null; }
      return controls;
    }

    if (this.phase==='coast_tli'){
      this.explain('coast_tli');
      controls.throttle=0; controls.timeScale=20000;
      const shipAbsNow=preState.shipAbs, moonAbsNow=preState.bodies.moon;
      const distMoonNow=Math.sqrt((shipAbsNow.x-moonAbsNow.x)**2+(shipAbsNow.y-moonAbsNow.y)**2+(shipAbsNow.z-moonAbsNow.z)**2);
      if (p.time-this.lastCorrection>3600*6){
        this.lastCorrection=p.time;
        const timeToArrival = speedNow>10 ? distMoonNow/speedNow : 1e9;
        const moonFuturePos = positionOf('moon', p.time+Math.min(timeToArrival,5*86400));
        const toTarget = norm3({x:moonFuturePos.x-shipAbsNow.x,y:moonFuturePos.y-shipAbsNow.y,z:moonFuturePos.z-shipAbsNow.z});
        const curDir = norm3({x:p.u,y:p.v,z:p.w});
        const dot = toTarget.x*curDir.x+toTarget.y*curDir.y+toTarget.z*curDir.z;
        const angleOff = Math.acos(Math.max(-1,Math.min(1,dot)));
        if (angleOff>0.005){
          const dv = Math.min(25, angleOff*speedNow*0.15);
          p.u += (toTarget.x-curDir.x)*dv; p.v += (toTarget.y-curDir.y)*dv; p.w += (toTarget.z-curDir.z)*dv;
        }
      }
      if (preState.body==='moon'){ this.phase='loi_burn'; this.phaseStart=p.time; this._loiSub='fall'; this._targetedOnce=false; this.explain('loi_burn'); }
      if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ El crucero hacia la Luna tardó demasiado sin llegar.'); return null; }
      return controls;
    }

    if (this.phase==='loi_burn'){
      this.explain('loi_burn');
      const rNow=SOLAR_BODIES.moon.radius+preState.altitude, GMm=G*SOLAR_BODIES.moon.mass;
      const vCirc=Math.sqrt(GMm/rNow);
      const radial=norm3({x:p.x,y:p.y,z:p.z});
      const velRadialMag=p.u*radial.x+p.v*radial.y+p.w*radial.z;
      const tangVec={x:p.u-velRadialMag*radial.x,y:p.v-velRadialMag*radial.y,z:p.w-velRadialMag*radial.z};
      const tangSpeed=Math.sqrt(tangVec.x**2+tangVec.y**2+tangVec.z**2);
      if (this._loiSub===undefined) this._loiSub='fall';
      let dir=null, throttle=0;
      controls.timeScale = this._loiSub==='fall' ? 300 : 1;

      if (this._loiSub==='fall'){
        if (!this._targetedOnce){
          this._targetedOnce=true;
          // Formula general (no asume energia casi-parabolica, que fallaba cuando la llegada
          // real tenia mas energia de la esperada): resuelve la tangencial exacta conservando
          // L y E entre el punto actual y el perilunio deseado, sea cual sea la energia real.
          const rPeriDeseado=SOLAR_BODIES.moon.radius+200000;
          const numerador = -(velRadialMag*velRadialMag) + 2*GMm*(1/rNow - 1/rPeriDeseado);
          const denominador = 1 - (rNow*rNow)/(rPeriDeseado*rPeriDeseado);
          const tangNecesaria=Math.sqrt(Math.max(0, numerador/denominador));
          const dv=tangNecesaria-tangSpeed; // puede ser negativo: hay que FRENAR tangencial, no solo acelerar
          const tangDir=tangSpeed>0.5?norm3(tangVec):norm3(cross3fix(radial));
          p.u+=tangDir.x*dv; p.v+=tangDir.y*dv; p.w+=tangDir.z*dv;
          this.app.toast.show('🎯 Empujón de puntería hacia un perilunio seguro de 200km.', 5000);
        }
        if (velRadialMag<0 && Math.abs(velRadialMag)<speedNow*0.5 && preState.altitude<1000000){ this._loiSub='approach'; }
        if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ La caída hacia la Luna no llegó a buen puerto.'); return null; }
      } else if (this._loiSub==='approach'){
        if (velRadialMag>=0){ this._loiSub='insert'; }
        if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ No se alcanzó el perilunio.'); return null; }
      } else {
        if (speedNow>vCirc*1.02){ dir=norm3({x:-p.u,y:-p.v,z:-p.w}); throttle=1; }
        else { throttle=0; }
      }
      const steer = dir ? p.autopilotSteer(dir) : {pitch:0,yaw:0,roll:0};
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=throttle;

      const speedAfter=Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
      if (this._loiSub==='insert' && speedAfter<=vCirc*1.02){
        this.phase='descent'; this.phaseStart=p.time; this._descSub='align'; this._fixedDeorbitDir=null; this._numBurns=1;
        this.explain('descent');
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la inserción orbital lunar.'); return null; }
      return controls;
    }

    if (this.phase==='descent'){
      this.explain('descent');
      const horizSpeed=preState.horizSpeed, vertSpeed=preState.vertSpeed, alt=preState.altitude;
      if (this._descSub===undefined) this._descSub='align';
      let dir=null, throttle=0;

      if (this._descSub==='align'){
        if (!this._fixedDeorbitDir) this._fixedDeorbitDir=norm3({x:-p.u,y:-p.v,z:-p.w});
        dir=this._fixedDeorbitDir;
        const localDirCheck=FRAME_ROTATION_INV(dir);
        const ta=RocketPhysics.targetAngles(localDirCheck);
        const pitchErrNow=Math.abs(RocketPhysics.wrapAngle(ta.pitch-p.pitch));
        const yawErrNow=Math.abs(RocketPhysics.wrapAngle(ta.yaw-p.yaw));
        throttle=0.002; // casi cero: girar no necesita el motor principal, solo control de actitud
        if ((pitchErrNow+yawErrNow)<0.1) this._descSub='burn';
      } else if (this._descSub==='burn'){
        dir=this._fixedDeorbitDir;
        const velAlongDir=p.u*dir.x+p.v*dir.y+p.w*dir.z;
        if (velAlongDir>=-2){
          throttle=0;
          if (horizSpeed>20 && alt>2000){
            this._numBurns=(this._numBurns||1)+1; this._fixedDeorbitDir=null; this._descSub='align';
          } else { this._descSub='final'; }
        } else {
          throttle = Math.max(0.02, Math.min(1, Math.abs(velAlongDir)/100));
        }
        if (alt<2000) this._descSub='final';
      } else {
        dir=norm3({x:p.x,y:p.y,z:p.z});
        const rNowFinal=SOLAR_BODIES.moon.radius+alt;
        const gLocal=(G*SOLAR_BODIES.moon.mass)/(rNowFinal*rNowFinal);
        const massNowFinal=p.dryMass+p.fuelMass;
        const targetDescentRate=-Math.max(1,Math.min(150,Math.sqrt(Math.max(0,alt))*0.6));
        const desiredAccel=(targetDescentRate-vertSpeed)*0.3;
        const neededThrustAccel=Math.max(0,desiredAccel+gLocal);
        throttle=Math.max(0,Math.min(1,neededThrustAccel*massNowFinal/p.maxThrust));
        // Freno horizontal suave y continuo (ayuda simplificada, igual que las correcciones de
        // rumbo del crucero): sin esto, la unica forma de quitar velocidad horizontal residual
        // seria un giro grande y brusco -- lo que se veia como la nave "girando frenetica".
        // En vez de eso, se recorta un poco cada fotograma, sin tocar la orientacion.
        const velRadialF=p.u*dir.x+p.v*dir.y+p.w*dir.z;
        const tangVecF={x:p.u-velRadialF*dir.x,y:p.v-velRadialF*dir.y,z:p.w-velRadialF*dir.z};
        const tangSpeedF=Math.sqrt(tangVecF.x**2+tangVecF.y**2+tangVecF.z**2);
        if (tangSpeedF>0.5){
          const frenoFactor=Math.pow(0.3, 1/60);
          p.u-=tangVecF.x*(1-frenoFactor); p.v-=tangVecF.y*(1-frenoFactor); p.w-=tangVecF.z*(1-frenoFactor);
        }
      }
      const steer = dir ? p.autopilotSteer(dir) : {pitch:0,yaw:0,roll:0};
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=throttle; controls.timeScale=1;

      if (alt<=2 && Math.abs(vertSpeed)<3 && horizSpeed<5){
        this.phase='done'; this.explain('done'); this.active=false;
      }
      if (alt<=2 && (Math.abs(vertSpeed)>=3 || horizSpeed>=5)){
        this.stop('💥 Alunizaje demasiado duro.');
        return null;
      }
      if (preState.fuelPercent<=0 && alt>2){ this.stop('⚠️ Sin combustible durante el descenso.'); return null; }
      return controls;
    }
    return null;
  }
}

/* ---------- APP ---------- */
class RocketSimApp {
  constructor(){
    this.physics=new RocketPhysics();
    this.sound=new SoundSystem();
    this.toast=new ToastSystem();
    this.hasOrbited=false; this.inReentry=false; this.hasBeenHigh=false;
    this.missionAuto = new MissionAutopilot(this);
    this.mapOpen=false; this.mapZoomVal=0.15; this.mapCenterMode='sun';
    // Enganche generico de misiones: el motor no sabe nada de "Apolo 11" ni de ningun otro
    // escenario concreto. Si el archivo que carga motor.js define window.MISSION_CONFIG
    // antes de esta linea, se activa el modo mision; si no, es el sandbox de siempre.
    this.mission = window.MISSION_CONFIG || null;
    if (this.mission){
      if (this.mission.physicsStack){
        this.physics.stack = new StageStack(this.mission.physicsStack);
      } else if (this.mission.fuelMass){
        this.physics.stack = new StageStack([{ id:'unica', dryMass:30000, fuelMass:this.mission.fuelMass, maxFuelMass:this.mission.fuelMass, thrust:this.mission.maxThrust||6500000, isp:450 }]);
      }
      (this.mission.stages||[]).forEach(st=>st.done=false);
    }
    const container=document.getElementById('viewport');
    this.renderer=new RocketRenderer3D(container);
    this.controls={throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:100,autopilot:'off'};
    this.setupUI();
    if (this.mission){
      const hud=document.getElementById('missionHud');
      if (hud){
        hud.style.display='block';
        document.getElementById('mhTitle').textContent='🎯 '+this.mission.title;
        this.updateMissionHud();
      }
      this.toast.show(this.mission.briefing, 8000);
    }
    this.lastTime=performance.now();
    this.loop();
    document.addEventListener('click',()=>{ if (!this.sound.enabled) this.sound.init(); },{once:true});
  }
  setupUI(){
    document.getElementById('throttle').addEventListener('input',(e)=>{
      this.controls.throttle=parseFloat(e.target.value);
      document.getElementById('throttleVal').textContent=Math.round(this.controls.throttle*100)+'%';
    });
    document.getElementById('pitch').addEventListener('input',(e)=>{
      this.controls.pitch=parseFloat(e.target.value);
      document.getElementById('pitchVal').textContent=Math.round(this.controls.pitch*90)+'°';
    });
    document.getElementById('yaw').addEventListener('input',(e)=>{
      this.controls.yaw=parseFloat(e.target.value);
      document.getElementById('yawVal').textContent=Math.round(this.controls.yaw*90)+'°';
    });
    document.getElementById('roll').addEventListener('input',(e)=>{
      this.controls.roll=parseFloat(e.target.value);
      document.getElementById('rollVal').textContent=Math.round(this.controls.roll*90)+'°';
    });
    // Mandos de resorte: al soltar (raton o dedo), vuelven solos al centro y dejan de mandar giro.
    // Sin esto, si sueltas el deslizador en +0.3 la nave sigue recibiendo ese mando todo el rato.
    ['pitch','yaw','roll'].forEach(id=>{
      const el=document.getElementById(id);
      const center=()=>{
        el.value=0; this.controls[id]=0;
        document.getElementById(id+'Val').textContent='0°';
      };
      el.addEventListener('mouseup',center);
      el.addEventListener('touchend',center);
      el.addEventListener('mouseleave',(e)=>{ if (e.buttons===1) center(); });
    });
    document.getElementById('btnLaunch').addEventListener('click',()=>{
      this.controls.throttle=1;
      document.getElementById('throttle').value=1;
      document.getElementById('throttleVal').textContent='100%';
      if (!this.sound.enabled) this.sound.init();
    });
    document.getElementById('btnReset').addEventListener('click',()=>{
      this.physics.reset();
      this.hasBeenHigh=false;
      if (this.missionAuto.active){
        this.missionAuto.stop();
        const btnMA=document.getElementById('btnMissionAuto');
        if (btnMA) btnMA.textContent='▶️ Ver misión automática';
        const statusMA=document.getElementById('mhAutoStatus');
        if (statusMA) statusMA.style.display='none';
        const maControls=document.getElementById('maControls');
        if (maControls) maControls.style.display='none';
      }
      const ts=this.controls.timeScale;
      this.controls={throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:ts,autopilot:'off'};
      document.getElementById('throttle').value=0;
      document.getElementById('pitch').value=0;
      document.getElementById('yaw').value=0;
      document.getElementById('roll').value=0;
      document.getElementById('throttleVal').textContent='0%';
      document.getElementById('pitchVal').textContent='0°';
      document.getElementById('yawVal').textContent='0°';
      document.getElementById('rollVal').textContent='0°';
      document.getElementById('badgeHyperspace').className='badge off';
      document.getElementById('badgeWarp').className='badge off';
      document.getElementById('statusDot').className='status-dot on';
      document.getElementById('statusText').textContent='EN ESPERA';
    });
    document.getElementById('btnRefuel').addEventListener('click',()=>{
      this.physics.refuel();
    });
    document.getElementById('btnDock').addEventListener('click',()=>{
      const ok=this.physics.tryDock();
      this.toast.show(ok?'🔗 Acoplado':'⚠️ Fuera de tolerancia', 3000);
    });
    document.getElementById('btnUndock').addEventListener('click',()=>{
      this.physics.undock();
      this.toast.show('🔓 Separado', 2000);
    });
    document.getElementById('btnEngineChem').addEventListener('click',()=>{
      this.physics.setEngine('chemical');
      document.getElementById('btnEngineChem').classList.add('active');
      document.getElementById('btnEngineNuke').classList.remove('active');
    });
    document.getElementById('btnEngineNuke').addEventListener('click',()=>{
      this.physics.setEngine('nuclear');
      document.getElementById('btnEngineNuke').classList.add('active');
      document.getElementById('btnEngineChem').classList.remove('active');
    });
    const apBtns={off:document.getElementById('btnApOff'),prograde:document.getElementById('btnApPro'),retrograde:document.getElementById('btnApRetro'),hold:document.getElementById('btnApHold')};
    Object.keys(apBtns).forEach(k=>{
      apBtns[k].addEventListener('click',()=>{
        this.controls.autopilot=k;
        if (k==='hold'){
          this.holdDir=RocketPhysics.rotateVec(0,1,0,this.physics.pitch,this.physics.yaw,this.physics.roll);
        }
        Object.values(apBtns).forEach(b=>b.classList.remove('active'));
        apBtns[k].classList.add('active');
      });
    });
    document.getElementById('btnHyperspace').addEventListener('click',()=>{
      this.controls.hyperspace=!this.controls.hyperspace;
      const badge=document.getElementById('badgeHyperspace');
      badge.className=`badge ${this.controls.hyperspace?'hyper':'off'}`;
      document.getElementById('btnHyperspace').classList.toggle('active');
      if (this.controls.hyperspace){ document.getElementById('statusDot').className='status-dot hyper'; document.getElementById('statusText').textContent='🌀 HIPERESPACIO'; }
      else { document.getElementById('statusDot').className='status-dot on'; document.getElementById('statusText').textContent='EN VUELO'; }
    });
    document.getElementById('btnWarp').addEventListener('click',()=>{
      this.controls.warp=!this.controls.warp;
      const badge=document.getElementById('badgeWarp');
      badge.className=`badge ${this.controls.warp?'warp':'off'}`;
      document.getElementById('btnWarp').classList.toggle('active');
      if (this.controls.warp){ document.getElementById('statusDot').className='status-dot warp'; document.getElementById('statusText').textContent='⚡ WARP DRIVE'; }
      else { document.getElementById('statusDot').className='status-dot on'; document.getElementById('statusText').textContent='EN VUELO'; }
    });
    document.getElementById('btnToggleView').addEventListener('click',()=>{
      const mode=this.renderer.toggleView();
      document.getElementById('btnToggleView').textContent=mode==='external'?'👁️ Cabina':'👁️ Externa';
    });
    document.getElementById('mvFront').addEventListener('click',()=>{
      this.renderer.setFocus(this.renderer.focusTarget==='earth' ? null : 'earth');
      document.getElementById('mvFront').classList.toggle('selected', this.renderer.focusTarget==='earth');
      document.getElementById('mvBack').classList.remove('selected');
    });
    document.getElementById('mvBack').addEventListener('click',()=>{
      this.renderer.setFocus(this.renderer.focusTarget==='moon' ? null : 'moon');
      document.getElementById('mvBack').classList.toggle('selected', this.renderer.focusTarget==='moon');
      document.getElementById('mvFront').classList.remove('selected');
    });
    const openMap=()=>{
      this.mapOpen=true;
      document.getElementById('mapOverlay').style.display='flex';
      this.resizeMapCanvas();
    };
    document.getElementById('btnMap').addEventListener('click',openMap);
    document.getElementById('btnMapFab').addEventListener('click',openMap);
    document.getElementById('btnHelp').addEventListener('click',()=>{
      document.getElementById('helpOverlay').style.display='flex';
    });
    document.getElementById('btnHelpClose').addEventListener('click',()=>{
      document.getElementById('helpOverlay').style.display='none';
    });
    const btnMissionAuto=document.getElementById('btnMissionAuto');
    if (btnMissionAuto){
      btnMissionAuto.addEventListener('click',()=>{
        if (this.missionAuto.active){
          this.missionAuto.stop('⏸️ Piloto automático detenido. Recuperas el control manual.');
          btnMissionAuto.textContent='▶️ Ver misión automática';
          document.getElementById('mhAutoStatus').style.display='none';
          document.getElementById('maControls').style.display='none';
        } else {
          this.missionAuto.start();
          btnMissionAuto.textContent='⏹️ Detener piloto automático';
          document.getElementById('mhAutoStatus').style.display='block';
          document.getElementById('maControls').style.display='flex';
          document.getElementById('btnMaPause').textContent='⏸️';
        }
      });
    }
    const btnMaPause=document.getElementById('btnMaPause');
    if (btnMaPause) btnMaPause.addEventListener('click',()=>{
      this.missionAuto.paused=!this.missionAuto.paused;
      btnMaPause.textContent=this.missionAuto.paused?'▶️':'⏸️';
    });
    document.querySelectorAll('.ma-speed').forEach(btn=>{
      btn.addEventListener('click',()=>{
        this.missionAuto.speed=parseInt(btn.dataset.speed,10);
        document.querySelectorAll('.ma-speed').forEach(b=>{
          b.style.background = b===btn ? 'rgba(255,179,71,.25)' : 'rgba(255,255,255,.05)';
          b.style.borderColor = b===btn ? 'var(--accent)' : 'var(--border-color)';
          b.style.color = b===btn ? 'var(--accent)' : 'var(--text-secondary)';
        });
      });
    });
    const btnMaSkip=document.getElementById('btnMaSkip');
    if (btnMaSkip) btnMaSkip.addEventListener('click',()=>{
      if (!this.missionAuto.active || this.missionAuto.paused) return;
      const startPhase=this.missionAuto.phase;
      let state=null, count=0;
      while (this.missionAuto.active && this.missionAuto.phase===startPhase && count<4000){
        const c=this.missionAuto.step();
        if (!c) break;
        this.controls=c;
        state=this.physics.step(1/60,c);
        count++;
      }
      if (state){ this.updateUI(state); this.checkMissionProgress(state); this.updateMissionHud(state); }
    });
    const INFO_TIPS={
      cabeceo:'🕹️ Cabeceo: inclina el morro arriba/abajo, como asentir con la cabeza.',
      guinada:'🕹️ Guiñada: gira el morro izquierda/derecha, como negar con la cabeza.',
      alabeo:'🕹️ Alabeo: gira la nave sobre su propio eje, como un sacacorchos.'
    };
    document.querySelectorAll('.info-i').forEach(el=>{
      el.addEventListener('click',(e)=>{
        e.stopPropagation();
        this.toast.show(INFO_TIPS[el.dataset.tip], 4000);
      });
    });
    document.getElementById('btnMapClose').addEventListener('click',()=>{
      this.mapOpen=false;
      document.getElementById('mapOverlay').style.display='none';
    });
    document.getElementById('mapZoom').addEventListener('input',(e)=>{
      this.mapZoomVal=parseFloat(e.target.value);
      const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
      const idx=Math.min(3,Math.floor(this.mapZoomVal*4));
      document.getElementById('mapZoomLabel').textContent=labels[idx];
    });
    const centerBtns={sun:document.getElementById('btnCenterSun'),earth:document.getElementById('btnCenterEarth'),ship:document.getElementById('btnCenterShip')};
    const smallCenterBtns=Array.from(document.querySelectorAll('#mapSmallRow .btn-small'));
    const clearAllCenterActive=()=>{
      Object.values(centerBtns).forEach(b=>b.classList.remove('active'));
      smallCenterBtns.forEach(b=>b.classList.remove('active'));
    };
    Object.keys(centerBtns).forEach(k=>{
      centerBtns[k].addEventListener('click',()=>{
        this.mapCenterMode=k;
        clearAllCenterActive();
        centerBtns[k].classList.add('active');
      });
    });
    smallCenterBtns.forEach(btn=>{
      btn.addEventListener('click',()=>{
        const key=btn.dataset.center;
        this.mapCenterMode = key==='kuiper' ? 'sun' : key;
        clearAllCenterActive();
        btn.classList.add('active');
        const zoomPreset = key==='kuiper' ? 0.03 : 0.55;
        this.mapZoomVal=zoomPreset;
        document.getElementById('mapZoom').value=zoomPreset;
        const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
        document.getElementById('mapZoomLabel').textContent=labels[Math.min(3,Math.floor(zoomPreset*4))];
      });
    });
    window.addEventListener('resize',()=>{ if (this.mapOpen) this.resizeMapCanvas(); });

    // Zoom tactil (pellizcar) y rueda del raton sobre el propio mapa
    const mapCanvasEl=document.getElementById('mapCanvas');
    const setZoomVal=(z)=>{
      z=Math.max(0,Math.min(1,z));
      this.mapZoomVal=z;
      document.getElementById('mapZoom').value=z;
      const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
      document.getElementById('mapZoomLabel').textContent=labels[Math.min(3,Math.floor(z*4))];
    };
    const ZOOM_RATIO=25000/3.5;
    const touchDist=(t)=>{ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); };
    let pinchStartDist=null, pinchStartZoom=null;
    mapCanvasEl.addEventListener('touchstart',(e)=>{
      if (e.touches.length===2){ pinchStartDist=touchDist(e.touches); pinchStartZoom=this.mapZoomVal; }
    },{passive:true});
    mapCanvasEl.addEventListener('touchmove',(e)=>{
      if (e.touches.length===2 && pinchStartDist){
        e.preventDefault();
        const scaleFactor=touchDist(e.touches)/pinchStartDist;
        setZoomVal(pinchStartZoom + Math.log(scaleFactor)/Math.log(ZOOM_RATIO));
      }
    },{passive:false});
    mapCanvasEl.addEventListener('touchend',(e)=>{ if (e.touches.length<2){ pinchStartDist=null; pinchStartZoom=null; } });
    mapCanvasEl.addEventListener('wheel',(e)=>{
      e.preventDefault();
      setZoomVal(this.mapZoomVal + (e.deltaY<0 ? 0.04 : -0.04));
    },{passive:false});
    const timeBtns={
      1:document.getElementById('btnTime1'), 100:document.getElementById('btnTime100'),
      3000:document.getElementById('btnTime3000'), 30000:document.getElementById('btnTime30000'),
      300000:document.getElementById('btnTime300000'), 3000000:document.getElementById('btnTime3000000')
    };
    Object.keys(timeBtns).forEach(k=>{
      timeBtns[k].addEventListener('click',()=>{
        this.controls.timeScale=parseInt(k,10);
        Object.values(timeBtns).forEach(b=>b.classList.remove('active'));
        timeBtns[k].classList.add('active');
      });
    });
  }
  updateUI(state){
    if (this.missionAuto.active){
      document.getElementById('throttle').value = this.controls.throttle;
      document.getElementById('pitch').value = this.controls.pitch;
      document.getElementById('yaw').value = this.controls.yaw;
      document.getElementById('roll').value = this.controls.roll;
    }
    document.getElementById('dDate').textContent = formatMissionDate(missionDate(state.time));
    document.getElementById('dElapsed').textContent = formatElapsed(state.time);
    // Actitud real de la nave (no el mando): pitch/roll en -180..180, rumbo (yaw) como brujula 0-360
    const toDeg180=r=>{ let d=(r*180/Math.PI)%360; if(d>180)d-=360; if(d<-180)d+=360; return d; };
    const toDeg360=r=>{ let d=(r*180/Math.PI)%360; if(d<0)d+=360; return d; };
    document.getElementById('realPitch').textContent = toDeg180(state.pitch).toFixed(0)+'°';
    document.getElementById('realYaw').textContent = toDeg360(state.yaw).toFixed(0)+'°';
    document.getElementById('realRoll').textContent = toDeg180(state.roll).toFixed(0)+'°';
    const BODY_LABELS = {earth:'🌍',moon:'🌑',mars:'🔴',jupiter:'🟠',io:'🌋',europa:'🧊',ganymede:'⚪',callisto:'⚫',saturn:'🪐',titan:'🟤',uranus:'🔵',neptune:'🔷',pluto:'❄️',sun:'☀️'};
    const bodyIcon = BODY_LABELS[state.body] || '❔';
    document.getElementById('tAltitude').textContent=bodyIcon+' '+formatDistance(state.altitude);
    document.getElementById('tVelocity').textContent=state.velocity.toFixed(0)+' m/s';
    document.getElementById('tFuel').textContent=state.fuelPercent.toFixed(0)+'%';
    document.getElementById('tGForce').textContent=state.gForce.toFixed(2)+'g';
    document.getElementById('tMass').textContent=(state.mass/1000).toFixed(0)+' t';
    document.getElementById('tVOrbit').textContent=state.vCirc.toFixed(0)+' m/s';
    document.getElementById('ovAltitude').textContent=formatDistance(state.altitude);
    document.getElementById('ovVelocity').textContent=state.velocity.toFixed(0);
    document.getElementById('ovGForce').textContent=state.gForce.toFixed(2);
    document.getElementById('badgeGForce').textContent=`📊 ${state.gForce.toFixed(1)}g`;
    document.getElementById('badgeGForce').className=state.gForce>3?'badge danger':'badge';
    const orbitBadge=document.getElementById('badgeOrbit');
    if (state.inOrbit){ orbitBadge.className='badge orbit'; orbitBadge.textContent='🛰️ ÓRBITA ✓'; }
    else if (state.ascending){ orbitBadge.className='badge warning'; orbitBadge.textContent='🚀 ASCENSO'; }
    else { orbitBadge.className='badge off'; orbitBadge.textContent='🛰️ ÓRBITA'; }
    document.getElementById('btnRefuel').style.display = state.inOrbit ? 'block' : 'none';

    const gArc=document.getElementById('gArc'), gLabel=document.getElementById('gLabel');
    if (gArc && gLabel){
      const g=Math.min(5,state.gForce||1);
      const circumference=157;
      gArc.style.strokeDashoffset=circumference-(g/5)*circumference;
      gArc.style.stroke = g>3?'#ff4444':g>2?'#ffaa00':'#00ff88';
      gLabel.textContent=g.toFixed(1)+'g';
    }

    if (state.inOrbit && !this.hasOrbited){
      this.hasOrbited=true;
      this.toast.show('🛰️ ¡ÓRBITA ALCANZADA! Velocidad: '+state.velocity.toFixed(0)+' m/s', 5000);
    }
    if (!state.inOrbit) this.hasOrbited=false;
    if (state.reentry && !this.inReentry){
      this.inReentry=true;
      this.toast.show('🔥 REENTRADA ATMOSFÉRICA', 3000);
    }
    if (!state.reentry) this.inReentry=false;
    const engineBadge=document.getElementById('badgeEngine');
    if (state.throttle>0.1 && state.fuelMass>0){ engineBadge.className='badge on'; engineBadge.textContent='🔥 MOTOR'; }
    else if (state.fuelMass<=0){ engineBadge.className='badge danger'; engineBadge.textContent='⛽ SIN COMBUSTIBLE'; }
    else { engineBadge.className='badge off'; engineBadge.textContent='⏸ MOTOR'; }
    const dot=document.getElementById('statusDot');
    if (state.inOrbit){ dot.className='status-dot on'; document.getElementById('statusText').textContent='🛰️ EN ÓRBITA'; }
    else if (state.hyperspace) dot.className='status-dot hyper';
    else if (state.warp) dot.className='status-dot warp';
    else if (state.throttle>0.1 && state.fuelMass>0){ dot.className='status-dot on'; document.getElementById('statusText').textContent='🚀 DESPEGANDO'; }
    else if (state.velocity>5){ dot.className='status-dot on'; document.getElementById('statusText').textContent='✈️ EN VUELO'; }
    else { dot.className='status-dot off'; document.getElementById('statusText').textContent='🟢 EN ESPERA'; }

    // HUD de aterrizaje: visible cerca de cualquier superficie cuando no estas en orbita
    const landingHud=document.getElementById('landingHud');
    if (state.altitude>20000) this.hasBeenHigh=true;
    const showLanding = !state.inOrbit && state.altitude < 15000 && state.body!=='sun' && this.hasBeenHigh;
    landingHud.style.display = showLanding ? 'block' : 'none';
    if (showLanding){
      document.getElementById('lhAlt').textContent = formatDistance(state.altitude);
      const vvertRow=document.getElementById('lhVvert').parentElement;
      document.getElementById('lhVvert').textContent = state.vertSpeed.toFixed(1)+' m/s';
      vvertRow.className = 'lh-row' + (state.vertSpeed<-30?' danger':state.vertSpeed<-8?' warn':'');
      document.getElementById('lhVhoriz').textContent = state.horizSpeed.toFixed(1)+' m/s';
      document.getElementById('lhFuel').textContent = state.fuelPercent.toFixed(0)+'%';
    }

    // HUD de acoplamiento: visible si hay un objetivo alcanzable a menos de 10km, o si ya estas acoplado
    const dockHud=document.getElementById('dockHud');
    const info=state.dockInfo;
    const showDock = !!state.dockedTo || (info && info.dist<10000);
    dockHud.style.display = showDock ? 'block' : 'none';
    if (showDock){
      if (state.dockedTo){
        document.getElementById('dhTitle').textContent='🔗 ACOPLADO';
        document.getElementById('dhName').textContent=info?info.target.name:state.dockedTo;
        document.getElementById('dhDist').textContent='0 m';
        document.getElementById('dhSpeed').textContent='0 m/s';
        document.getElementById('btnDock').style.display='none';
        document.getElementById('btnUndock').style.display='block';
      } else if (info){
        document.getElementById('dhTitle').textContent='🛰️ ACOPLAMIENTO';
        document.getElementById('dhName').textContent=info.target.name;
        document.getElementById('dhDist').textContent=formatDistance(info.dist);
        document.getElementById('dhSpeed').textContent=info.relSpeed.toFixed(2)+' m/s';
        document.getElementById('btnDock').style.display = info.canDock ? 'block' : 'none';
        document.getElementById('btnUndock').style.display='none';
      }
    }

    // Pista contextual: cambia sola segun la fase de vuelo, para no depender de un consejo fijo
    // escondido en un footer que nadie relee una vez ha empezado a jugar.
    let hint=null;
    if (state.dockedTo){
      hint='🔗 Acoplado — da algo de gas para separarte';
    } else if (info && info.dist<10000){
      hint = info.canDock ? '🛰️ ¡Dentro de tolerancia! Pulsa Acoplar' : '🛰️ Iguala velocidad y acércate despacio';
    } else if (showLanding){
      if (state.vertSpeed<-30) hint='🛬 ¡Frena! Velocidad vertical peligrosa';
      else if (state.vertSpeed<-8) hint='🛬 Reduce la velocidad de descenso';
      else hint='🛬 Descenso controlado, sigue así';
    } else if (state.inOrbit){
      hint='🛰️ ¡En órbita! Prueba Prógrado/Retrógrado para maniobrar';
    } else if (state.reentry){
      hint='🔥 Reentrada atmosférica en curso';
    } else if (state.ascending){
      hint='📈 Sigue acelerando — vigila Velocidad frente a V. Orbital';
    } else if (state.body==='earth' && state.altitude>40000 && state.altitude<150000 && state.throttle>0.05){
      hint='🔄 Empieza a inclinar poco a poco hacia el horizonte';
    } else if (state.throttle>0.1 && state.altitude<40000){
      hint='🚀 Subiendo — mantén el cabeceo en 0° los primeros segundos';
    } else if (state.throttle<0.05 && state.altitude<100 && state.velocity<5){
      hint='🚀 Pulsa Lanzar para despegar';
    }
    const flightHint=document.getElementById('flightHint');
    if (hint){ flightHint.textContent=hint; flightHint.classList.add('show'); }
    else flightHint.classList.remove('show');

    // Eclipse (simplificacion: al ser orbitas coplanares, se alinea cada mes, no es tan raro como en la realidad)
    if (state.eclipse && !this.lastEclipse){
      this.toast.show(state.eclipse==='solar' ? '🌑 ECLIPSE SOLAR' : '🌕 ECLIPSE LUNAR', 4000);
    }
    this.lastEclipse = state.eclipse;
  }
  loop(){
    const now=performance.now();
    const rawDt=Math.min(0.05,(now-this.lastTime)/1000);
    this.lastTime=now;
    const FIXED_DT=1/60; // paso fijo para el piloto automatico: las maniobras de precision
    // (frenar justo al cruzar velocidad cero, converger la actitud) se probaron y calibraron
    // con este paso exacto. Usar el tiempo real del fotograma (que varia segun lo rapido que
    // vaya el ordenador dibujando la escena 3D) rompia esa precision en equipos mas lentos.

    let state=null;
    if (this.missionAuto.active){
      if (!this.missionAuto.paused){
        const ticks=Math.max(1,Math.min(20,this.missionAuto.speed||1));
        for (let i=0;i<ticks;i++){
          const autoControls=this.missionAuto.step();
          if (!autoControls) break;
          this.controls=autoControls;
          state=this.physics.step(FIXED_DT,autoControls);
          if (!this.missionAuto.active) break;
        }
      }
      if (!state) state=this.physics.getState();
    } else {
      if (this.controls.autopilot!=='off'){
        const p=this.physics;
        const speed=Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
        let dir;
        if (this.controls.autopilot==='hold' && this.holdDir){
          dir=this.holdDir;
        } else if (speed<0.5){
          dir=RocketPhysics.rotateVec(0,1,0,p.pitch,p.yaw,p.roll); // sin velocidad: mantener rumbo actual
        } else {
          dir = this.controls.autopilot==='retrograde'
            ? {x:-p.u/speed,y:-p.v/speed,z:-p.w/speed}
            : {x:p.u/speed,y:p.v/speed,z:p.w/speed};
        }
        const steer=p.autopilotSteer(dir);
        this.controls.pitch=steer.pitch; this.controls.yaw=steer.yaw; this.controls.roll=steer.roll;
      }
      state=this.physics.step(rawDt,this.controls);
    }

    if (this.sound.enabled) this.sound.update(state.throttle,state.rpm,state.gForce,state.velocity,state.altitude);
    this.updateUI(state);
    this.checkMissionProgress(state);
    if (this.mission) this.updateMissionHud(state);
    if (this.mapOpen) this.drawMap(state);
    else this.renderer.update(state, rawDt, this.missionAuto ? this.missionAuto.phase : null);
    requestAnimationFrame(()=>this.loop());
  }
  updateMissionHud(state){
    if (!this.mission) return;
    document.getElementById('mhStages').innerHTML = this.mission.stages.map(st=>
      `<span class="mh-stage${st.done?' done':''}">${st.done?'✓':'○'} ${st.label}</span>`
    ).join(' &nbsp; ');
    const ms=this.mission.milestones;
    if (ms && state){
      const next=ms.find(m=>m.t>state.time);
      const hud=document.getElementById('mhNext');
      if (hud){
        if (next){
          const diff=next.t-state.time;
          hud.textContent = (diff<0?'⏰ YA TOCABA — ':'⏳ En '+formatElapsed(diff)+' — ')+next.label;
        } else {
          hud.textContent = '✅ Cronología real completada';
        }
      }
    }
    const btnMissionAuto=document.getElementById('btnMissionAuto');
    const statusEl=document.getElementById('mhAutoStatus');
    if (btnMissionAuto && statusEl){
      if (this.missionAuto.active){
        btnMissionAuto.textContent='⏹️ Detener piloto automático';
        statusEl.style.display='block';
        statusEl.textContent='🤖 '+this.missionAuto.statusLabel()+'...';
      } else if (btnMissionAuto.textContent!=='▶️ Ver misión automática'){
        // el piloto se paro solo (exito, fallo, o combustible agotado): reflejarlo en el boton
        btnMissionAuto.textContent='▶️ Ver misión automática';
        if (this.missionAuto.phase==='done'){ statusEl.textContent='🎉 Completado automáticamente'; }
        else { statusEl.style.display='none'; }
      }
    }
  }
  checkMissionProgress(state){
    if (!this.mission) return;
    let changed=false;
    for (const st of this.mission.stages){
      if (!st.done && st.check(state)){
        st.done=true; changed=true;
        this.toast.show(st.msg, 5000);
      }
    }
    if (changed) this.updateMissionHud(state);
  }
  resizeMapCanvas(){
    const canvas=document.getElementById('mapCanvas');
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1, 3);
    canvas.width=rect.width*dpr; canvas.height=rect.height*dpr;
    canvas.style.width=rect.width+'px'; canvas.style.height=rect.height+'px';
    this._mapDpr=dpr;
  }
  drawMap(state){
    const canvas=document.getElementById('mapCanvas');
    const ctx=canvas.getContext('2d');
    const dpr=this._mapDpr||1;
    const w=canvas.width/dpr, h=canvas.height/dpr;
    if (w===0||h===0) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#03030a'; ctx.fillRect(0,0,w,h);
    const cx=w/2, cy=h/2;

    const minPPA=3.5, maxPPA=25000;
    const ppa = minPPA*Math.pow(maxPPA/minPPA, this.mapZoomVal);
    const ppm = ppa/AU;

    let center={x:0,z:0};
    if (this.mapCenterMode==='ship') center={x:state.shipAbs.x,z:state.shipAbs.z};
    else if (this.mapCenterMode!=='sun' && state.bodies[this.mapCenterMode]) center={x:state.bodies[this.mapCenterMode].x,z:state.bodies[this.mapCenterMode].z};

    const toScreen=(x,z)=>({x:cx+(x-center.x)*ppm, y:cy+(z-center.z)*ppm});

    // cinturon de Kuiper
    const sunS=toScreen(0,0);
    ctx.strokeStyle='rgba(138,120,96,0.8)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,41*AU*ppm,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,48*AU*ppm,0,Math.PI*2); ctx.stroke();

    // orbita de Halley (elipse real, muestreada)
    ctx.strokeStyle='rgba(200,220,255,0.35)';
    ctx.beginPath();
    for (let i=0;i<=64;i++){
      const M=(i/64)*2*Math.PI;
      const E=(function(M,e){let E=M;for(let k=0;k<20;k++){E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));}return E;})(M,0.96658);
      const a=HALLEY.a;
      const r=a*(1-0.96658*Math.cos(E));
      const nu=2*Math.atan2(Math.sqrt(1.96658)*Math.sin(E/2),Math.sqrt(0.03342)*Math.cos(E/2));
      const xo=r*Math.cos(nu), zo=r*Math.sin(nu)*Math.cos(2.83);
      const s=toScreen(xo,zo);
      if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y);
    }
    ctx.closePath(); ctx.stroke();

    // orbitas y cuerpos
    const colorOf=(name)=>{
      const c={earth:0x3a8fd9, moon:0xaaaaaa}[name];
      if (c!==undefined) return c;
      return (SOLAR_BODIES[name]&&SOLAR_BODIES[name].color) || 0xffffff;
    };
    const DISPLAY_NAME={
      earth:'Tierra', moon:'Luna', mars:'Marte', jupiter:'Júpiter',
      io:'Ío', europa:'Europa', ganymede:'Ganímedes', callisto:'Calisto',
      saturn:'Saturno', titan:'Titán', uranus:'Urano', neptune:'Neptuno', pluto:'Plutón'
    };
    function drawLabel(text,x,y){
      ctx.font='11px "Courier New",monospace';
      ctx.lineWidth=3; ctx.strokeStyle='rgba(3,3,10,0.9)';
      ctx.strokeText(text,x,y);
      ctx.fillStyle='#e8e8f0';
      ctx.fillText(text,x,y);
    }
    const RING_INFO={
      saturn:{inner:1.3, outer:2.3, rgb:'216,201,160'},
      uranus:{inner:1.6, outer:2.0, rgb:'85,101,112'}
    };
    SOLAR_BODY_NAMES.forEach(name=>{
      const b=SOLAR_BODIES[name];
      const parentPos = b.parent==='sun' ? {x:0,z:0} : state.bodies[b.parent];
      const parentScreen = toScreen(parentPos.x, parentPos.z);
      ctx.strokeStyle='rgba(120,140,160,0.18)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(parentScreen.x,parentScreen.y,b.a*ppm,0,Math.PI*2); ctx.stroke();

      const pos=state.bodies[name];
      const s=toScreen(pos.x,pos.z);
      const isMoon = b.parent!=='sun';
      const minDotR = isMoon ? 2 : 4;
      const realR = b.radius*ppm; // tamaño real a este zoom: crece de verdad al ampliar
      const dotR = Math.max(minDotR, realR);
      const hex='#'+colorOf(name).toString(16).padStart(6,'0');

      const ring=RING_INFO[name];
      if (ring && realR>1.5){
        ctx.strokeStyle=`rgba(${ring.rgb},0.65)`;
        ctx.lineWidth=Math.max(1,(ring.outer-ring.inner)*realR);
        ctx.beginPath(); ctx.arc(s.x,s.y,(ring.inner+ring.outer)/2*realR,0,Math.PI*2); ctx.stroke();
      }

      // Indicador de altura sobre el plano de la eclíptica: anillo azul si esta por encima,
      // ambar si por debajo, mas intenso cuanto mayor sea la desviacion (util ahora que las
      // orbitas tienen inclinacion real y ya no estan todas en el mismo plano).
      const heightAU=pos.y/AU;
      if (Math.abs(heightAU)>0.001){
        const heightOpacity=Math.min(0.85, Math.abs(heightAU)/2);
        ctx.strokeStyle = heightAU>0 ? `rgba(100,180,255,${heightOpacity})` : `rgba(255,170,80,${heightOpacity})`;
        ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(s.x,s.y,dotR+3,0,Math.PI*2); ctx.stroke();
      }

      ctx.beginPath(); ctx.arc(s.x,s.y,dotR,0,Math.PI*2); ctx.fillStyle=hex; ctx.fill();
      // las lunas necesitan mas zoom antes de mostrar su nombre, si no se amontonan sobre su planeta
      const labelThreshold = isMoon ? 400 : 15;
      if (ppa>labelThreshold){
        const heightTxt = Math.abs(heightAU)>0.01 ? ` (${heightAU>0?'+':''}${heightAU.toFixed(2)} UA)` : '';
        drawLabel((DISPLAY_NAME[name]||name)+heightTxt, s.x+dotR+3, s.y+3);
      }
    });

    // Sol
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,6,0,Math.PI*2); ctx.fillStyle='#ffcc66'; ctx.fill();
    if (ppa>3) drawLabel('Sol', sunS.x+9, sunS.y+3);

    // Halley (posicion actual)
    const hs=toScreen(state.bodies.halley.x, state.bodies.halley.z);
    ctx.beginPath(); ctx.arc(hs.x,hs.y,2.5,0,Math.PI*2); ctx.fillStyle='#ddeeff'; ctx.fill();
    if (ppa>3) drawLabel('Halley', hs.x+6, hs.y+3);

    // nave
    const shipS=toScreen(state.shipAbs.x, state.shipAbs.z);
    ctx.beginPath(); ctx.arc(shipS.x,shipS.y,4,0,Math.PI*2); ctx.fillStyle='#ff3333'; ctx.fill();
    ctx.strokeStyle='#ff3333'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(shipS.x,shipS.y,8,0,Math.PI*2); ctx.stroke();
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  try {
    const app=new RocketSimApp();
    document.addEventListener('click',()=>{ if (!app.sound.enabled) app.sound.init(); });
    document.addEventListener('keydown',(e)=>{
      if (e.key===' '||e.key==='l'){ document.getElementById('btnLaunch').click(); e.preventDefault(); }
      if (e.key==='r') document.getElementById('btnReset').click();
      if (e.key==='h') document.getElementById('btnHyperspace').click();
      if (e.key==='w') document.getElementById('btnWarp').click();
      if (e.key==='v') document.getElementById('btnToggleView').click();
    });
  } catch(err){
    const el=document.getElementById('statusMsg');
    el.style.display='block';
    el.textContent='⚠️ Error al iniciar: '+err.message;
    console.error(err);
  }
});
