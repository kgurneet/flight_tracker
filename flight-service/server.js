import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';

// Simple world airports (mirrors airport-service to avoid cross-service startup ordering)
const AIRPORTS = [
  { iata: 'JFK', name: 'John F. Kennedy Intl', lat: 40.6413, lon: -73.7781 },
  { iata: 'LAX', name: 'Los Angeles Intl', lat: 33.9416, lon: -118.4085 },
  { iata: 'ORD', name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
  { iata: 'DFW', name: 'Dallas/Fort Worth Intl', lat: 32.8998, lon: -97.0403 },
  { iata: 'YYZ', name: 'Toronto Pearson', lat: 43.6777, lon: -79.6248 },
  { iata: 'CDG', name: 'Paris Charles de Gaulle', lat: 49.0097, lon: 2.5479 },
  { iata: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543 },
  { iata: 'DXB', name: 'Dubai Intl', lat: 25.2532, lon: 55.3657 },
  { iata: 'HND', name: 'Tokyo Haneda', lat: 35.5494, lon: 139.7798 },
  { iata: 'SYD', name: 'Sydney', lat: -33.9399, lon: 151.1753 }
];

const app = express();
app.use(cors());
app.use(express.json());

/** Compute initial bearing degrees between two points */
function bearingDegrees(from, to) {
  const φ1 = from.lat * Math.PI / 180;
  const φ2 = to.lat * Math.PI / 180;
  const Δλ = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  const deg = (θ * 180 / Math.PI + 360) % 360;
  return deg;
}

/** Move a lat/lon by distance (km) along a bearing (deg) */
function move(from, bearingDeg, distanceKm) {
  const R = 6371; // km
  const δ = distanceKm / R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = from.lat * Math.PI / 180;
  const λ1 = from.lon * Math.PI / 180;

  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ), cosδ = Math.cos(δ);
  const sinθ = Math.sin(θ), cosθ = Math.cos(θ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * cosθ;
  const φ2 = Math.asin(sinφ2);
  const y = sinθ * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return { lat: φ2 * 180 / Math.PI, lon: ((λ2 * 180 / Math.PI + 540) % 360) - 180 };
}

/** Haversine distance (km) */
function distanceKm(a, b) {
  const R = 6371;
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function pickDifferentAirports() {
  const from = AIRPORTS[Math.floor(Math.random()*AIRPORTS.length)];
  let to = AIRPORTS[Math.floor(Math.random()*AIRPORTS.length)];
  while (to.iata === from.iata) to = AIRPORTS[Math.floor(Math.random()*AIRPORTS.length)];
  return { from, to };
}

function makeFlight(id) {
  const { from, to } = pickDifferentAirports();
  const heading = bearingDegrees(from, to);
  const speedKts = Math.floor(380 + Math.random()*180); // 380-560 kts
  const altitudeFt = Math.floor(28000 + Math.random()*12000); // 28k-40k ft
  const callsign = `CC${String(Math.floor(Math.random()*9999)).padStart(4,'0')}`;
  const now = Date.now();

  // Start a little away from origin
  const start = move({ lat: from.lat, lon: from.lon }, heading, Math.random()*50 + 10);

  return {
    id,
    callsign,
    from: from.iata,
    to: to.iata,
    lat: start.lat,
    lon: start.lon,
    heading,
    speedKts,
    altitudeFt,
    createdAt: now,
    updatedAt: now
  };
}

const FLIGHTS = new Map();
const FLIGHT_COUNT = 20;
for (let i=0;i<FLIGHT_COUNT;i++) {
  const id = nanoid(8);
  FLIGHTS.set(id, makeFlight(id));
}

/** Advance flight along route by elapsed time since last update */
function tick(f) {
  const now = Date.now();
  const dtHours = Math.max(0, (now - f.updatedAt)) / 3600000;
  if (dtHours <= 0) return f;
  const kmPerHr = f.speedKts * 1.852; // why: knots->km/h
  const stepKm = kmPerHr * dtHours;

  const next = move({ lat: f.lat, lon: f.lon }, f.heading, stepKm);
  const old = { lat: f.lat, lon: f.lon };
  f.lat = next.lat;
  f.lon = next.lon;
  f.updatedAt = now;

  // If near destination, re-route
  const dest = AIRPORTS.find(a => a.iata === f.to);
  if (dest && distanceKm({ lat: f.lat, lon: f.lon }, dest) < 30) {
    const { from, to } = pickDifferentAirports();
    f.from = from.iata;
    f.to = to.iata;
    f.heading = bearingDegrees(from, to);
  }

  // Small wander to avoid straight line monotony
  f.heading = (f.heading + (Math.random()*2 - 1) * 2) % 360;

  return f;
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'flight-service' }));

app.get('/api/flights', (_req, res) => {
  const list = [];
  for (const f of FLIGHTS.values()) list.push(tick(f));
  res.json(list);
});

app.get('/api/flights/:id', (req, res) => {
  const f = FLIGHTS.get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.json(tick(f));
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`🛩️  flight-service listening on http://localhost:${PORT}`));
