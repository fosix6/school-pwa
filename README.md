# 🏫 School Management PWA

A progressive web app for managing school attendance and cleaning duties (piket), powered by Google Sheets.

## ✨ Features

- ✅ Real-time attendance tracking
- 🧹 Piket (cleaning duty) management
- 📊 WhatsApp-ready reports
- 📱 Offline support with background sync
- 🔒 Secure API key management via GitHub Secrets

## 🚀 Deployment

### Prerequisites

1. Google Sheets with Apps Script (see Google Sheets Setup)
2. GitHub repository
3. GitHub Pages enabled

### Setup

1. Clone this repository
2. Set up Google Sheets and Apps Script (see below)
3. Add `APPS_SCRIPT_URL` as a GitHub Secret
4. Push to `main` branch - GitHub Actions will deploy

### Google Sheets Setup

1. Create a new Google Sheet with tabs: `Students`, `Attendance`, `Piket`, `Config`
2. Go to Extensions > Apps Script
3. Paste the Apps Script code from the documentation
4. Deploy as Web App
5. Copy the deployment URL

### GitHub Secrets

1. Go to Settings > Secrets and variables > Actions
2. Add new secret: `APPS_SCRIPT_URL`
3. Value: Your Google Apps Script deployment URL

### Local Development

```bash
npm install
npm run dev  # Preview src/
npm run build  # Build to dist/
npm run preview  # Preview built version