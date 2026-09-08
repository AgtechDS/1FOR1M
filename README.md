# 1FOR1M

## Overview
A virtual marketplace showing 1 million lots at 1€ each. Users sign in with Google, browse a virtualized grid of lots, select lots, upload media (image/video/audio, max 720px) on hover, and checkout via Stripe.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS with virtualized grid
- **Auth**: Supabase Auth (Google OAuth)
- **Database**: Supabase PostgreSQL
- **Storage**: Supabase Storage for media
- **Payments**: Stripe Checkout
- **Style**: Street/Urban (Permanent Marker + Anton fonts, orange/black palette)

## Project Structure
```
1FOR1M/
├── index.html          # Main page
├── styles.css          # Street style
├── config.js           # API keys & settings
├── app.js              # Frontend logic
├── supabase_schema.sql # Database schema
├── server/
│   ├── index.js        # Express server (Stripe webhooks + checkout API)
│   └── stripe.js       # Stripe integration
└── README.md
```

## Setup

### 1. Supabase
Run `supabase_schema.sql` in your Supabase SQL editor to create tables and seed 1M lots.

### 2. Configure keys
Edit `config.js` with your:
- `supabaseUrl` + `supabaseAnonKey`
- `stripePublishableKey`
- `googleClientId`
- `apiBase`

### 3. Server
```bash
cd server && npm install
npm start
```

### 4. Stripe Webhooks
Configure your Stripe webhook endpoint to point to `/api/webhook` and add the webhook secret.

## Features
- Google OAuth login
- Virtualized grid of 1M lots (scrollable, page-based)
- Drag-to-select multiple lots
- Media upload on hover (image/video/audio, auto-resized to 720px)
- Stripe checkout with quantity selector
- Real-time stats (available/sold counts)

## License
Proprietary — AGTech Design# 1FOR1M
