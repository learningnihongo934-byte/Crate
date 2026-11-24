// Reads Spotify data exports: the my_spotify_data.zip itself, or the JSON files inside it.
// Supports Extended Streaming History (Streaming_History_Audio_*.json) and the basic
// Account Data history (StreamingHistory_music_*.json / StreamingHistory*.json).

const u32 = (v, o) => v.getUint32(o, true);
const u16 = (v, o) => v.getUint16(o, true);

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// Minimal zip reader: returns [{name, text()}] for .json entries.
export function readZip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That zip looks damaged.');
  let count = u16(v, eocd + 10);
  let off = u32(v, eocd + 16);
  const out = [];
  const dec = new TextDecoder();
  while (count-- > 0 && u32(v, off) === 0x02014b50) {
    const method = u16(v, off + 10);
    const csize = u32(v, off + 20);
    const nlen = u16(v, off + 28), elen = u16(v, off + 30), clen = u16(v, off + 32);
    const local = u32(v, off + 42);
    const name = dec.decode(new Uint8Array(buf, off + 46, nlen));
    off += 46 + nlen + elen + clen;
    if (!/\.json$/i.test(name) || name.includes('__MACOSX')) continue;
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const bytes = new Uint8Array(buf, start, csize);
    out.push({ name, text: () => (method === 0 ? Promise.resolve(dec.decode(bytes)) : inflate(bytes)) });
  }
  return out;
}

const isHistoryName = (n) => /Streaming_?History/i.test(n) && !/Video/i.test(n);

export function rowsFrom(json) {
  if (!Array.isArray(json)) return { rows: [], podcasts: 0 };
  const rows = [];
  let podcasts = 0;
  for (const r of json) {
    if ('ts' in r) {
      if (!r.master_metadata_track_name) { podcasts++; continue; }
      const id = (r.spotify_track_uri || '').split(':')[2] || '';
      const t = Date.parse(r.ts);
      if (!t) continue;
      rows.push({
        t, ms: r.ms_played | 0, n: r.master_metadata_track_name, a: r.master_metadata_album_artist_name || '',
        b: r.master_metadata_album_album_name || '', u: id, s: r.skipped ? 1 : 0, src: 'x',
      });
    } else if ('endTime' in r && r.trackName) {
      if (r.trackName === 'Unknown Track') continue;
      const t = Date.parse(r.endTime.replace(' ', 'T') + 'Z');
      if (!t) continue;
      rows.push({ t, ms: r.msPlayed | 0, n: r.trackName, a: r.artistName || '', b: '', u: '', s: 0, src: 'x' });
    } else if ('episode_name' in r || 'podcastName' in r) podcasts++;
  }
  for (const r of rows) r.k = `${Math.round(r.t / 1000)}|${r.u || r.n + '|' + r.a}`;
  return { rows, podcasts };
}

// files: FileList/array of File. onProgress(text). Returns { rows, files, podcasts }.
export async function importFiles(files, onProgress = () => {}) {
  const sources = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      onProgress(`Opening ${f.name}…`);
      for (const e of readZip(await f.arrayBuffer())) if (isHistoryName(e.name)) sources.push(e);
    } else if (/\.json$/i.test(f.name)) {
      sources.push({ name: f.name, text: () => f.text() });
    }
  }
  if (!sources.length) throw new Error('No Spotify streaming history found. Look for files named Streaming_History_Audio_… or StreamingHistory_music_…');
  const all = [];
  let podcasts = 0;
  for (const [i, s] of sources.entries()) {
    onProgress(`Reading ${s.name.split('/').pop()} (${i + 1}/${sources.length})…`);
    let json;
    try { json = JSON.parse(await s.text()); } catch { continue; }
    const r = rowsFrom(json);
    all.push(...r.rows);
    podcasts += r.podcasts;
  }
  return { rows: all, files: sources.length, podcasts };
}
