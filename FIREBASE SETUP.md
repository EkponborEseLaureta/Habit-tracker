# Turning on Suggestions & Admin (free, about 10 minutes, one time)

The app works fully without this. This only switches on:
- The "Send a suggestion" box in Settings, used by anyone.
- The Admin page, used by you (and anyone you add) — suggestions, a visitor count, and posting an update banner everyone sees on the Today page.

Nothing else changes. No cost, ever, at the traffic this app will realistically get
(Firebase's free "Spark" plan covers far more than a personal app needs, and it
never asks for a card on that plan).

## 1. Create your free Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Add project**, name it (e.g. "ese-habit-tracker"), skip Google Analytics if asked, click **Create project**.

## 2. Turn on Authentication
1. In the left menu, click **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**. Save.

## 3. Turn on the database
1. In the left menu, click **Build → Firestore Database → Create database**.
2. Choose **Start in production mode**, pick any location, click **Enable**.
3. Click the **Rules** tab, delete everything there, and paste this exactly:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /suggestions/{id} {
      allow create: if true;
      allow read, delete, update: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }
    match /admins/{email} {
      allow read: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
      allow write: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }
    match /devices/{id} {
      allow create: if true;
      allow read, update, delete: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }
    match /stats/{id} {
      allow create, update: if true;
      allow get, list: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }
    match /announcements/{id} {
      allow read: if true;
      allow write: if request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
4. Click **Publish**.

What this means, in plain terms:
- `suggestions`: anyone can send one; only admins can read or delete them.
- `admins`: only admins can view or change who's an admin.
- `devices` / `stats`: lets the app count how many phones have opened it, without anyone but an admin being able to read that.
- `announcements`: anyone can see the current update banner; only admins can post or clear one.
- `users`: each signed-in person can only read and write their own habit data — nobody, including you as the admin, can read another person's habits, water or exercise through this rule. (Admin visibility is limited to suggestions, the visitor count, and who's an admin — not personal habit data.)

## Everyone now needs an account
Since Authentication is already on from step 2, every visitor — not just admins —
now has to sign up or sign in before they reach the app. Their habits are then
tied to that account and follow them to any device they sign in on. This is a
bigger change than the admin-only version: if this isn't what you want, use a
version of `index.html` from before this update, where only admins needed to sign in
and everyone else could use the app straight away, no account, entirely on their device.

## 4. Add yourself as the first admin
Someone has to be admin #1 before the app can add anyone else, so this one step is manual:
1. Still in Firestore, click **Start collection**. Collection ID: `admins`.
2. Document ID: type your own email in lowercase, exactly, e.g. `ese@example.com`.
3. Add any field to it, e.g. field `owner` (type: boolean) = `true`. Save.

## 5. Get your config and paste it into the app
1. Click the gear icon (top left) → **Project settings**.
2. Scroll to **Your apps**, click the **</>** (web) icon, give it any nickname, click **Register app**.
3. Firebase shows a `firebaseConfig` object. Copy those six values.
4. Open `index.html`, find `FIREBASE_CONFIG` near the top of the `<script>` section, and paste your values in, replacing the `PASTE_...` placeholders.
5. Save, and push/upload the updated `index.html` to your GitHub repo.

## 6. Sign in as admin in the app
1. Open your app. You'll land on the welcome screen (everyone does now).
2. Click **Create account**, enter the *same email* you used in step 4, and choose a password.
3. Once signed in, go to **Settings → Admin**. You'll see every suggestion sent, the visitor count, and an **Add an admin** box.

## Adding another admin later
1. In the app's Admin page, type their email under **Add an admin** and click **Add**.
2. Tell them to open the app and use **Create account** on the welcome screen with that exact email.
3. After signing up, they'll see the Admin option under Settings too.

## If something goes wrong
- "Could not send" on a suggestion: check the Rules were pasted and published (step 3).
- Can't sign in / sign up: check Email/Password is enabled (step 2).
- Admin page says "not an admin": the email must match, lowercase, exactly what's in the `admins` collection.
