# JOY INBOX

JOY INBOX is a private WhatsApp Cloud API customer-support inbox.

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
- Persistent pin, archive, restore, and mark-as-read actions
- Long-press and multi-select chat deletion
- Long-press/right-click message actions, reply, text copy/forward, message pinning, and owner-only message deletion
- Pinned-message filter and selection toolbar for message forwarding/deletion
- Chat filters, paged chat/message history, and per-conversation search
- Owner-managed contacts, plus WhatsApp contact names received in webhook payloads
- Incoming and outgoing images, video, audio, and supported documents
- Authenticated media retrieval through five-minute signed object URLs
- First-inbound greeting with duplicate protection and service-window checks
- Live backend diagnostics for WhatsApp, Firestore, and storage configuration
- Light, dark, and system appearance preferences
- FCM Web Push integration for incoming WhatsApp text messages; Android background delivery requires device testing

## Current integration scope

Text, images, video, audio files, and supported documents use the official Cloud API. Client uploads are limited to 3 MiB to fit the configured Lambda request path; incoming media retrieval is capped at 16 MiB. Media types are checked by MIME and content signature on the backend. Media is stored in the configured private Firebase Storage bucket; the app returns short-lived signed URLs only after owner authentication. Storage is unavailable unless `FIREBASE_STORAGE_BUCKET` is configured and the Firebase service account has bucket access.

The inbox initially listens to the latest 50 conversations and messages, and loads older pages on demand. The `/chat-state` endpoint authenticates the Firebase owner and persists chat pin, archive, restore, and read-state changes in Firestore. The `/message-state` endpoint persists message pins; `/delete-messages` deletes only the selected message documents in the specified conversation after owner-token verification. `/delete-chats` verifies the same owner token and permanently removes selected chat documents and message subcollections; contacts and settings remain untouched. Replies send the selected Firestore message reference to the API, which resolves its WhatsApp message ID for Cloud API context and stores a quote snapshot (original text, sender, and type) on the outgoing message. The inbox renders that saved snapshot after refresh and can use the stored reference to jump back to the original message. Forwarding resends text as a new message; media forwarding and a native forwarded marker are not supported. The documented Cloud API message reference does not expose edit or delete-for-everyone operations, so those actions are unavailable. Contacts are owner-scoped in `users/{uid}/contacts`; API credentials and chat/message writes remain server-only.

Push notification support uses the existing Firebase web app configuration and Firebase Admin SDK. The owner must enable notifications from Settings; permission is never requested automatically. The Lambda sends data-only FCM messages only after a new incoming WhatsApp text message is stored, so webhook retries, outgoing messages, and status updates do not send duplicate notifications. Device tokens are stored by the authenticated backend under `fcmTokens/{ownerUid}/devices`; Firestore rules deny all client access to that collection. The service worker suppresses a system notification while an app window is visible and routes a clicked notification to the matching conversation. Android/browser settings control notification sound and may suppress it. The implementation is not considered delivery-verified until the Android background/locked-screen test below succeeds.

Greeting messages send once on the first newly received message in a conversation and only while that inbound message is within WhatsApp's 24-hour customer-service window. An attempted greeting is not automatically retried after an ambiguous API failure, preventing duplicate greetings. Check the conversation warning and backend logs if a greeting fails. This does not implement approved message templates or outbound campaigns.

Automatic media-object retention is not configured. Set and document an object-lifecycle/retention policy for the Firebase Storage bucket that meets the business's legal and operational requirements before storing production customer media.

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
│   ├── public/
│   │   └── firebase-messaging-sw.js
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
│   │   ├── push.js
│   │   ├── security.js
│   │   ├── webhook.js
│   │   └── whatsapp.js
│   ├── .env.example
│   └── package.json
├── firestore.rules
├── storage.rules
├── firestore.indexes.json
├── .gitignore
└── README.md
## Deploy and connect

### Deploy the backend to AWS Lambda

From `backend/`, install the production dependency and create a ZIP whose root contains `index.js`:

```sh
cd backend
npm install --omit=dev
zip -r ../joy-inbox-lambda.zip index.js src node_modules package.json
```

In AWS Lambda, use the Node.js 22 runtime and set the handler to `index.handler`. Upload `joy-inbox-lambda.zip`. Configure the environment variables from `backend/.env.example`; `CORS_ORIGINS` must be the exact deployed frontend origin. Set `FIREBASE_PRIVATE_KEY` with literal `\\n` separators or actual newlines.

Create a Function URL with auth type `NONE`. The handler authenticates `/send` with Firebase ID tokens and verifies Meta signatures on the webhook. Keep the Firebase Admin key, WhatsApp access token, Meta app secret, and verify token only in Lambda environment variables.

Required backend settings are `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and `CORS_ORIGINS`. The allowed owner is fixed in the frontend and backend source as UID `Vy49nGnw74gR5SFHmjN0DOQ2QFE3`; no `OWNER_UID` environment variable is required or used.
For media, also configure `FIREBASE_STORAGE_BUCKET` and grant the service account object read/write access. `GRAPH_API_VERSION` selects the Meta Graph API version and defaults to `v26.0`. Deploy Firestore and Storage rules with the Firebase CLI (`firebase deploy --only firestore:rules,storage`); Storage rules deny direct client access because media reads use authenticated backend-generated signed URLs. Configure an appropriate Cloud Storage lifecycle policy separately; the app does not delete media automatically.

### Configure the WhatsApp webhook

In the Meta developer dashboard, configure the callback URL as the Lambda Function URL followed by `/webhook`, for example `https://YOUR_FUNCTION_ID.lambda-url.YOUR_REGION.on.aws/webhook`. Use the same `WHATSAPP_VERIFY_TOKEN` value configured in Lambda, then subscribe the WhatsApp webhook to the `messages` field.

Meta's verification request is handled by `GET /webhook`; incoming events are handled by `POST /webhook`. The endpoint accepts signed webhook requests only, so `META_APP_SECRET` must match the Meta app that owns the WhatsApp configuration.

### Configure the frontend and test

Set frontend values from `frontend/.env.example`, including `VITE_API_BASE_URL` as the Lambda Function URL without a path suffix. Add the frontend domain to Firebase Authentication's authorized domains and set the matching origin in Lambda's `CORS_ORIGINS`. Build and deploy the frontend, then sign in as the Firebase user whose UID is fixed in source as the owner.

The Cloudflare Pages project serves from the domain root, so its Vite build uses `/` as the asset base by default. The GitHub Pages workflow sets `GITHUB_PAGES=true` to build with the repository-path base.

### Configure FCM Web Push

1. In Firebase Console, open **Project settings → Cloud Messaging** and create a Web Push certificate key pair if one is not already configured. Copy its public key into `VITE_FIREBASE_VAPID_KEY`; it is a public web configuration value, not a service-account credential.
2. Keep the existing Firebase web configuration and messaging sender ID aligned with this same Firebase project. Ensure Firebase Cloud Messaging HTTP v1 is enabled and the Lambda service-account identity has the `cloudmessaging.messages.create` permission.
3. For local/Codespaces development, add `VITE_FIREBASE_VAPID_KEY` to `frontend/.env.local`. Open the app over the HTTPS forwarded Codespaces URL, allow that origin to use notifications, then enable notifications from Joy Inbox Settings. Notification permission must be granted by a user gesture.
4. For GitHub Pages, add the repository Actions variable `VITE_FIREBASE_VAPID_KEY`. The deploy workflow passes it into the Vite build. The deployed GitHub Pages origin must be an authorized Firebase Authentication domain. HTTPS is required for service workers and Web Push.
5. Deploy the complete [`firestore.rules`](./firestore.rules) file so browser clients cannot read the server-only FCM token registry. Repackage the backend with the existing Lambda ZIP instructions so `src/push.js` is included, then deploy only with approval. No new Lambda environment variable or AWS production setting is introduced.

Test by enabling notifications on an Android device, minimizing/closing Joy Inbox, locking the screen, and sending a new inbound WhatsApp text from a separate phone. Confirm one notification shows the sender and preview, and tapping it opens the right conversation. Check Android's site/app notification sound settings; the Web Notifications API does not let the app override the OS's notification sound policy. This end-to-end Android test cannot be performed from GitHub Codespaces, and push delivery should not be considered verified until it passes.

Run the backend reply regression tests with `npm test --prefix backend`. To test messaging live, send a WhatsApp message to the configured business number and confirm it appears in the inbox. Reply from the inbox to test `/send`, then verify the quote remains inside the sent bubble after refreshing and that clicking it returns to the original. Repeat with a reply to an outgoing message and with a media reply; these live checks require deploying the updated Lambda and frontend. Also test attachments smaller than 3 MiB and incoming media smaller than 16 MiB with the storage bucket configured. Test pin/archive/read, contacts, pagination, and greeting within the customer-service window. WhatsApp requires an approved template for business-initiated messages outside the 24-hour service window; template sending is not implemented.
