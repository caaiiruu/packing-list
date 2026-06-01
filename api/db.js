const https = require('https');

const OWNER = 'caaiiruu';
const REPO  = 'packing-list';
const PATH  = 'db.json';
const TOKEN = process.env.GH_TOKEN;

function ghRequest(method, body, sha) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${PATH}`,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'packing-list-app',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getDb() {
  const r = await ghRequest('GET');
  if (r.status === 404) return { data: null, sha: null };
  const content = Buffer.from(r.body.content, 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: r.body.sha };
}

async function putDb(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = {
    message: `update db ${Date.now()}`,
    content,
    ...(sha ? { sha } : {})
  };
  const r = await ghRequest('PUT', body);
  return r;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, sha } = await getDb();
      return res.status(200).json({ data: data || { trips: [], members: [] }, sha });
    }

    if (req.method === 'POST') {
      const { action, payload, sha: clientSha } = req.body;

      // Read current state
      const { data: db, sha: serverSha } = await getDb();
      const current = db || { trips: [], members: [] };

      let updated = JSON.parse(JSON.stringify(current));

      if (action === 'save_trip') {
        const idx = updated.trips.findIndex(t => t.id === payload.trip.id);
        if (idx >= 0) updated.trips[idx] = payload.trip;
        else updated.trips.push(payload.trip);
      } else if (action === 'delete_trip') {
        updated.trips = updated.trips.filter(t => t.id !== payload.tripId);
      } else if (action === 'save_members') {
        updated.members = payload.members;
      } else if (action === 'patch_item') {
        // Fast path: only update one item's checked/mc/log state
        const trip = updated.trips.find(t => t.id === payload.tripId);
        if (trip) {
          const { catIdx, itemIdx, isBacklog, patch } = payload;
          const item = isBacklog ? trip.backlog[itemIdx] : trip.cats[catIdx].items[itemIdx];
          if (item) Object.assign(item, patch);
        }
      }

      updated.updatedAt = Date.now();
      const r = await putDb(updated, serverSha);
      if (r.status === 409) {
        return res.status(409).json({ error: 'conflict', message: 'Please retry' });
      }
      return res.status(200).json({ ok: true, sha: r.body?.content?.sha });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
