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
  const mu = G * parent.mass;
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
  const parent = SOLAR_BODIES[obj.parent];
  const r = parent.radius + obj.altitude;
  const mu = G * parent.mass;
  const period = 2 * Math.PI * Math.sqrt(Math.pow(r, 3) / mu);
  const n = 2 * Math.PI / period;

  const angle = obj.phase0 + n * t;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const inc = obj.inclination;
  const raan = obj.raan;
  const cosI = Math.cos(inc), sinI = Math.sin(inc);
  const cosR = Math.cos(raan), sinR = Math.sin(raan);

  const dxp = -r * n * sinA;
  const dzp =  r * n * cosA;

  const dyp  = dzp * sinI;
  const dzp2 = dzp * cosI;

  const dx2 = dxp * cosR - dzp2 * sinR;
  const dz2 = dxp * sinR + dzp2 * cosR;

  return { x: dx2, y: dyp, z: dz2 };
}
