#!/bin/sh
# Publishes ONLY the app files to Firebase Hosting (https://ecomsoc-checkout.web.app).
# Nothing else in this folder (tests, docs, QR images with the team code) is ever uploaded.
# Needs Node.js and a Firebase login:  npx firebase-tools login
set -e
cd "$(dirname "$0")/.."
mkdir -p .deploy
rsync -a --delete index.html qr.js sw.js manifest.webmanifest logo.jpg icons .deploy/
# the link-preview image must use this site's own address (the source file points at the GitHub Pages copy)
sed 's#https://joseph-vincent-sdb.github.io/checkout-challenge/#https://ecomsoc-checkout.web.app/#g' index.html > .deploy/index.html
npx firebase-tools deploy --only hosting --project "${FIREBASE_PROJECT:-ecomsoc-checkout-7k4q}"
