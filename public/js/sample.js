// Sample listening history with made-up artists, so Crate can be explored before a real export arrives.
const ARTISTS = [
  ['Paper Lanterns', ['Low Tide', 'Signal Fires']], ['Mira Okafor', ['Glass House']], ['The Quiet Hours', ['Night Bus', 'Kept']],
  ['Juno Vale', ['Halflight']], ['Static Garden', ['Weeds', 'Bloom Period']], ['Teo Marlowe', ['Cassette Summer']],
  ['Northbound', ['Interstate']], ['Hana Ishida', ['Rainy Season', 'Ume']], ['Velvet Arcade', ['Coin Slot']],
  ['Kofi Adams', ['Long Way']], ['Lumen & The Few', ['Small Hours']], ['Rosa Vance', ['Borrowed Time']],
  ['Overpass', ['Concrete Poems']], ['Sable Kids', ['Recess']], ['Ines Duarte', ['Maré']], ['Dial Tone', ['Hold Music']],
  ['Ashby Road', ['Terrace']], ['Wren Holloway', ['Field Notes']], ['Koto Club', ['Late Train']], ['Basement Choir', ['Hymns for Nobody']],
];
const WORDS = 'Neon Rain Paper Moon Slow Burn Echo Gold Window Fever Ghost Harbor Motel Satellite Velvet Sunday Static Orbit Ember Lilac Midnight Highway Daydream Cinder Polaroid Tide Halo Mirror Comet Honey Rust Bloom Signal Hollow Arcade'.split(' ');

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeSample() {
  const r = rng(7);
  const tracks = [];
  ARTISTS.forEach(([artist, albums], ai) => {
    for (const album of albums) {
      const n = 6 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const name = `${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]}`;
        tracks.push({ n: name, a: artist, b: album, len: 150000 + Math.floor(r() * 120000), w: Math.pow(r(), 3) * (1.6 - ai / 20), born: Math.floor(r() * 650) });
      }
    }
  });
  const now = Date.now();
  const rows = [];
  const DAYS = 730;
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(now - d * 864e5);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const sessions = r() < 0.08 ? 0 : 1 + Math.floor(r() * (weekend ? 4 : 3));
    const pool = tracks.filter((t) => DAYS - d >= t.born || t.born > 600);
    const total = pool.reduce((s, t) => s + t.w, 0);
    // a "phase": one track gets hammered for a couple of weeks
    const phase = pool[Math.floor((d / 14) % pool.length)];
    for (let s = 0; s < sessions; s++) {
      const hour = weekend ? 10 + Math.floor(r() * 14) : [8, 9, 13, 17, 18, 21, 22, 23][Math.floor(r() * 8)];
      let t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(r() * 60)).getTime();
      const len = 4 + Math.floor(r() * 16);
      for (let i = 0; i < len; i++) {
        let tr;
        if (r() < 0.12) tr = phase;
        else { let x = r() * total; tr = pool.find((p) => (x -= p.w) <= 0) || pool[0]; }
        const skipped = r() < 0.13;
        const ms = skipped ? 4000 + Math.floor(r() * 40000) : tr.len;
        t += ms;
        if (t > now) break;
        rows.push({ t, ms, n: tr.n, a: tr.a, b: tr.b, u: '', s: skipped ? 1 : 0, src: 'd', k: `d${t}|${tr.n}|${tr.a}` });
      }
    }
  }
  return rows;
}
