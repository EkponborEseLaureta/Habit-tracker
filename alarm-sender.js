/* Ese Daily Habit Tracker — free alarm sender (runs on GitHub, no card needed).
   Started about every minute. Sends alarms that became due since the last run.
   It only ever sees TIMES and short codes, never habit names.
   It never prints any secret or phone token to the public log. */
const admin = require("firebase-admin");

async function main() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (!sa.project_id) { console.log("Missing FIREBASE_SERVICE_ACCOUNT secret."); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();

  const nowAbs = Math.floor(Date.now() / 60000);          // minutes since 1970 (UTC)
  const stateRef = db.collection("system").doc("reminders");

  // Claim the time window first, so two runs can never send the same alarm twice.
  let fromAbs;
  try {
    fromAbs = await db.runTransaction(async (t) => {
      const s = await t.get(stateRef);
      const last = s.exists ? s.data().lastMinute : nowAbs - 1;
      if (last >= nowAbs) throw new Error("already done");
      t.set(stateRef, { lastMinute: nowAbs, at: new Date().toISOString() });
      return Math.max(last + 1, nowAbs - 45);              // never send alarms more than 45 min late
    });
  } catch (e) { console.log("Nothing new to send."); return; }

  const minutes = [];
  for (let a = fromAbs; a <= nowAbs; a++) minutes.push(a % 1440);   // UTC minute of the day

  const docs = new Map();
  for (let i = 0; i < minutes.length; i += 30) {
    const snap = await db.collection("push").where("mins", "array-contains-any", minutes.slice(i, i + 30)).get();
    snap.forEach((d) => docs.set(d.id, d));
  }

  const jobs = [];
  docs.forEach((doc) => {
    const d = doc.data(), tags = new Set();
    minutes.forEach((m) => ((d.slots || {})[String(m)] || []).slice(0, 10).forEach((t) => tags.add(String(t).slice(0, 60))));
    (d.tokens || []).slice(0, 5).forEach((token) => tags.forEach((tag) => jobs.push({ ref: doc.ref, token, tag })));
  });

  let sent = 0, failed = 0;
  const dead = new Map();
  for (let i = 0; i < jobs.length; i += 500) {
    const chunk = jobs.slice(i, i + 500);
    const res = await admin.messaging().sendEach(chunk.map((j) => ({
      token: j.token, data: { tag: j.tag }, webpush: { headers: { Urgency: "high", TTL: "1800" } },
    })));
    res.responses.forEach((r, k) => {
      if (r.success) { sent++; return; }
      failed++;
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        const j = chunk[k];
        if (!dead.has(j.ref.path)) dead.set(j.ref.path, { ref: j.ref, tokens: new Set() });
        dead.get(j.ref.path).tokens.add(j.token);
      }
    });
  }
  for (const { ref, tokens } of dead.values()) {
    await ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...tokens) }).catch(() => {});
  }
  console.log(`Checked ${minutes.length} minute(s): ${sent} alarm(s) sent, ${failed} failed.`);
}
main().catch((e) => { console.log("Error: " + (e && e.message ? e.message.slice(0, 200) : "unknown")); process.exit(1); });
