#!/bin/sh
# Publishes ONLY the app files to Firebase Hosting (https://ecomsoc-checkout.web.app),
# and (first) the database security rules.
# Nothing else in this folder (tests, docs, QR images with the team code) is ever uploaded.
# Needs Node.js and a Firebase login:  npx firebase-tools login
#
# ORDER MATTERS: the rules go out BEFORE the app. This version of the app writes a few extra fields
# (what each phone has applied, battery, message seen). Old rules refuse unknown fields, so a new app
# on old rules would have its phone records refused (the app then falls back to the basic record, but the
# new organiser controls would not work). New rules accept both old and new phones, so publishing them
# first can never break a phone that is already open.
#   SKIP_RULES=1 ./scripts/deploy-hosting.sh   publishes the app only (when the rules have not changed)
set -e
cd "$(dirname "$0")/.."
PROJECT="${FIREBASE_PROJECT:-ecomsoc-checkout-7k4q}"
mkdir -p .deploy
rsync -a --delete index.html qr.js sw.js manifest.webmanifest logo.jpg icons .deploy/
# the link-preview image must use this site's own address (the source file points at the GitHub Pages copy)
sed 's#https://joseph-vincent-sdb.github.io/checkout-challenge/#https://ecomsoc-checkout.web.app/#g' index.html > .deploy/index.html
if [ -z "$SKIP_RULES" ]; then
  npx firebase-tools deploy --only database --project "$PROJECT"
fi
npx firebase-tools deploy --only hosting --project "$PROJECT"
