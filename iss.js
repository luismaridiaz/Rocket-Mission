/* ============================================================
   ESTACIÓN ESPACIAL INTERNACIONAL — objeto orbital
   ============================================================
   Datos reales de la ISS:
   - Altitud: 408 km (media)
   - Inclinación real: 51.64° — aquí usamos 5.2°, la misma latitud
     de Kourou, para que sea alcanzable sin cambio de plano. Es el
     mismo compromiso que ya se hizo con el plano orbital de la Luna.
   - Periodo real: 92.68 min — el conseguido aquí depende de la
     órbita real que la nave logre, no es un número fijo impuesto.
   - Masa: 420.000 kg. Viga: 109 m. Con paneles: 73 m de ancho.
   ============================================================ */

const ISS_INCLINATION = 5.2 * Math.PI / 180; // igual que la latitud de Kourou (LAUNCH_SITE)

const ISS = {
  id: 'iss',
  name: 'Estación Espacial Internacional',
  parent: 'earth',
  altitude: 408000,
  inclination: ISS_INCLINATION,
  raan: 0,
  phase0: 2.2, // posicion inicial arbitraria en su orbita, no calculada de efemerides reales
  mass: 420000,
  radius: 55
};

// Posición de un objeto orbital (ISS) en el tiempo t. Reutiliza positionOf() del motor
// para la posición del cuerpo padre (Tierra). Devuelve coordenadas en el mismo marco que
// el resto del motor (heliocéntrico si el padre orbita al Sol).
function orbitalObjectPosition(obj, t) {
  const parent = SOLAR_BODIES[obj.parent];
  const parentPos = positionOf(obj.parent, t);

  const r = parent.radius + obj.altitude;
  const mu = 6.674e-11 * parent.mass;
  const period = 2 * Math.PI * Math.sqrt(Math.pow(r, 3) / mu);

  const angle = obj.phase0 + (2 * Math.PI / period) * t;

  const xp = r * Math.cos(angle);
  const zp = r * Math.sin(angle);
  const inc = obj.inclination;
  const yp = zp * Math.sin(inc);
  const zp2 = zp * Math.cos(inc);

  const raan = obj.raan;
  const x2 = xp * Math.cos(raan) - zp2 * Math.sin(raan);
  const z2 = xp * Math.sin(raan) + zp2 * Math.cos(raan);

  return { x: parentPos.x + x2, y: parentPos.y + yp, z: parentPos.z + z2, r, period };
}

// Velocidad GEOCENTRICA (relativa al cuerpo padre, no heliocentrica): hay que restar el
// movimiento del padre en cada muestra antes de derivar, o se mezcla la velocidad orbital
// de la ISS con la velocidad de la Tierra alrededor del Sol (~30km/s en vez de ~7,7km/s) --
// y esa velocidad tiene que coincidir con el marco de referencia de la nave, que es
// relativo a la Tierra, no al Sol.
function orbitalObjectVelocity(obj, t) {
  const dt = 1;
  const parent0 = positionOf(obj.parent, t);
  const parent1 = positionOf(obj.parent, t + dt);
  const p0 = orbitalObjectPosition(obj, t);
  const p1 = orbitalObjectPosition(obj, t + dt);
  const rel0 = { x: p0.x-parent0.x, y: p0.y-parent0.y, z: p0.z-parent0.z };
  const rel1 = { x: p1.x-parent1.x, y: p1.y-parent1.y, z: p1.z-parent1.z };
  return { x: (rel1.x-rel0.x)/dt, y: (rel1.y-rel0.y)/dt, z: (rel1.z-rel0.z)/dt };
}
