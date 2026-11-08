import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

const requiredConfig = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
};

const missingConfig = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

function renderStartupError(message: string, details?: string[]) {
  root.render(
    <main className="flex min-h-screen items-center justify-center bg-[#eef2f3] px-4 py-8">
      <section className="w-full max-w-xl rounded-2xl bg-white p-7 shadow-lg">
        <h1 className="text-xl font-bold text-[#075e54]">JOY INBOX could not start</h1>
        <p className="mt-3 text-sm text-gray-700">{message}</p>
        {details && (
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-gray-600">
            {details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        )}
      </section>
    </main>
  );
}

if (missingConfig.length > 0) {
  renderStartupError(
    "Frontend environment variables are missing. Add them to frontend/.env.local for local development or to GitHub Actions repository variables for Pages deployments.",
    missingConfig
  );
} else {
  import("./App")
    .then(({ default: App }) => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    })
    .catch((error: unknown) => {
      console.error("JOY INBOX startup failed:", error);
      renderStartupError(
        "The app failed while loading Firebase or its startup modules. Check the browser console and confirm the Firebase configuration is valid."
      );
    });
}
