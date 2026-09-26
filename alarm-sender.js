/* Ese Daily Habit Tracker — free alarm sender.
   cron-job.org triggers this GitHub Action every minute.

   Reliability strategy:
   1) Re-check the last few minutes so a reminder that synced slightly late is not lost.
   2) Wait for the NEXT minute boundary and send that minute's alarms immediately,
      which removes most of the GitHub Actions start-up delay.
   3) Store a tiny per-tag delivery marker in each push document so re-checking recent
      minutes does not create duplicate notifications.

   The server only sees UTC minute numbers, short alarm tags and push tokens — never
   the user's habit names. Notification wording stays on the user's device. */

const admin = require("firebase-admin");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minuteOfDay = (absMinute) => ((absMinute % 1440) + 1440) % 1440;

async function matchingDocs(db, absMinutes) {
  const mins = [...new Set(absMinutes.map(minuteOfDay))];
  const docs = new Map();

  for (let i = 0; i < mins.length; i += 30) {
    const snap = await db.collection("push")
      .where("mins", "array-contains-any", mins.slice(i, i + 30))
      .get();

    snap.forEach((d) => docs.set(d.id, d));
  }

  return docs;
}

async function sendMinutes(db, absMinutes, label) {
  const uniqueAbs = [...new Set(absMinutes)].sort((a, b) => a - b);

  if (!uniqueAbs.length) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const docs = await matchingDocs(db, uniqueAbs);
  const jobs = [];
  const docState = new Map();
  let skipped = 0;

  docs.forEach((doc) => {
    const d = doc.data() || {};
    const sentMap = Object.assign({}, d.sent || {});

    docState.set(doc.ref.path, {
      ref: doc.ref,
      sentMap,
      tokens: (d.tokens || []).slice(0, 5)
    });

    uniqueAbs.forEach((absMinute) => {
      const minute = minuteOfDay(absMinute);
      const tags = ((d.slots || {})[String(minute)] || []).slice(0, 10);

      tags.forEach((rawTag) => {
        const tag = String(rawTag).slice(0, 60);

        if (Number(sentMap[tag]) === absMinute) {
          skipped++;
          return;
        }

        (d.tokens || []).slice(0, 5).forEach((token) => {
          jobs.push({
            ref: doc.ref,
            path: doc.ref.path,
            token,
            tag,
            absMinute
          });
        });
      });
    });
  });

  let sent = 0;
  let failed = 0;

  const dead = new Map();
  const delivered = new Set();

  for (let i = 0; i < jobs.length; i += 500) {
    const chunk = jobs.slice(i, i + 500);

    const res = await admin.messaging().sendEach(
      chunk.map((j) => ({
        token: j.token,
        data: {
          tag: j.tag
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "300"
          }
        }
      }))
    );

    res.responses.forEach((r, k) => {
      const j = chunk[k];

      if (r.success) {
        sent++;
        delivered.add(
          `${j.path}\u0000${j.tag}\u0000${j.absMinute}`
        );
        return;
      }

      failed++;

      const code = r.error && r.error.code;

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        if (!dead.has(j.path)) {
          dead.set(j.path, {
            ref: j.ref,
            tokens: new Set()
          });
        }

        dead.get(j.path).tokens.add(j.token);
      }
    });
  }

  for (const key of delivered) {
    const [path, tag, absText] = key.split("\u0000");
    const state = docState.get(path);

    if (state) {
      state.sentMap[tag] = Number(absText);
    }
  }

  const writes = [];

  for (const [path, state] of docState) {
    const hadDelivery = [...delivered].some(
      (k) => k.startsWith(path + "\u0000")
    );

    if (hadDelivery) {
      writes.push(
        state.ref.set(
          {
            sent: state.sentMap,
            lastDeliveredAt: new Date().toISOString()
          },
          { merge: true }
        ).catch(() => {})
      );
    }
  }

  for (const { ref, tokens } of dead.values()) {
    writes.push(
      ref.update({
        tokens: admin.firestore.FieldValue.arrayRemove(...tokens)
      }).catch(() => {})
    );
  }

  await Promise.all(writes);

  console.log(
    `${label}: ${sent} sent, ${failed} failed, ${skipped} duplicate(s) skipped.`
  );

  return {
    sent,
    failed,
    skipped
  };
}

async function main() {
  const sa = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT || "{}"
  );

  if (!sa.project_id) {
    console.log("Missing FIREBASE_SERVICE_ACCOUNT secret.");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(sa)
  });

  const db = admin.firestore();

  // Check the last few minutes too, so a newly saved alarm is not missed.
  const nowAbs = Math.floor(Date.now() / 60000);

  await sendMinutes(
    db,
    [
      nowAbs - 3,
      nowAbs - 2,
      nowAbs - 1,
      nowAbs
    ],
    "Recent check"
  );

  // Wait until the next exact minute while this GitHub runner is already active.
  const targetAbs =
    Math.floor(Date.now() / 60000) + 1;

  const targetMs =
    targetAbs * 60000;

  const waitMs =
    Math.max(
      0,
      targetMs - Date.now() + 100
    );

  if (
    waitMs > 0 &&
    waitMs < 61000
  ) {
    await sleep(waitMs);
  }

  await sendMinutes(
    db,
    [targetAbs],
    "On-time check"
  );
}

main().catch((e) => {
  console.log(
    "Error: " +
    (
      e &&
      e.message
        ? e.message.slice(0, 200)
        : "unknown"
    )
  );

  process.exit(1);
});
