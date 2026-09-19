# RiskGuard — Real-Time Payment Risk Assistant

A complete, dependency-light full-stack demo for the challenge:

**TRANSACTION + CONTEXT → RISK MODEL → EXPLANATION → USER ACTION**

## Run locally

Requirements: Node.js 18+

```bash
npm start
```

Open **http://localhost:3000**.

No `npm install` is required: the backend uses Node's built-in HTTP server and the frontend is vanilla HTML/CSS/JS.

## What is implemented

- Live payment monitor with risk states and instant actions.
- `/api/analyze` adaptive risk scoring using a learned mean/standard-deviation baseline, recipient history, device and location familiarity, QR context, payment velocity and message-language signals.
- Explainability panel showing each contributing signal and recommendation.
- Behavioral baseline page showing learned transaction behavior.
- Graph fraud detection bonus with account/device/recipient relationships and a coordinated shared-device cluster.
- Responsive frontend and working navigation.

## API

- `GET /api/health`
- `GET /api/transactions`
- `GET /api/behavior`
- `GET /api/graph`
- `POST /api/analyze`

Example request:

```json
{
  "amount": 25000,
  "recipient": "Unknown Merchant",
  "recipientId": "ACC-777",
  "device": "Android 14 / Pixel",
  "location": "Mumbai, IN",
  "qr": true,
  "velocity": 3.5,
  "message": "Please confirm this payment immediately to avoid an account fee."
}
```

## Production note

This is a fully working demo with seeded data. For a production deployment, connect the same API layer to your transaction database/event stream, authenticated user profiles, device telemetry, geolocation signals and a persistent graph store. The current risk model is intentionally transparent so a hackathon judge can see why a transaction received its score.
