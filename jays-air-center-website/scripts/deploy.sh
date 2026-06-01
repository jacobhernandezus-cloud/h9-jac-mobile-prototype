#!/bin/bash
# Manual deployment script for Jay's Air Center website
# Usage: ./scripts/deploy.sh (from app directory)
#    or: ./apps/jays-air-center-website/scripts/deploy.sh (from repo root)

set -e

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm ci

echo "Building CSS..."
npm run build

echo "Deploying to Netlify..."
npx netlify deploy --prod

echo "Deployment complete!"
