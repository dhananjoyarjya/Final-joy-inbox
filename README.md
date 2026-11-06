# Joy Inbox

Joy Inbox is a private WhatsApp Cloud API customer-support inbox.

## Project stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Firebase Authentication
- Cloud Firestore
- Lucide Icons

### Backend
- Node.js 22
- AWS Lambda
- WhatsApp Cloud API
- Firebase Admin SDK

## Features

- Owner authentication
- Real-time chat list
- Real-time text message history
- Incoming WhatsApp text messages
- Outgoing WhatsApp text messages
- Saved Quick Replies
- Quick Reply search
- Slash shortcut in the message composer
- Owner-restricted Firestore access

## Project structure

```text
joy-inbox/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── firebase/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── types/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── backend/
│   ├── src/
│   │   ├── firebase.js
│   │   ├── index.js
│   │   ├── security.js
│   │   ├── webhook.js
│   │   └── whatsapp.js
│   ├── .env.example
│   └── package.json
├── firestore.rules
├── firestore.indexes.json
├── .gitignore
└── README.md
