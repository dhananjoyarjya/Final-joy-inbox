importScripts("https://www.gstatic.com/firebasejs/12.5.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.5.0/firebase-messaging-compat.js");

const config = Object.fromEntries(new URL(self.location.href).searchParams.entries());
firebase.initializeApp(config);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(async (payload) => {
  const data = payload.data || {};
  if (data.type !== "incoming_whatsapp_text" || !data.chatId || !data.messageId) {
    return;
  }

  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (windows.some((client) => client.visibilityState === "visible")) {
    return;
  }

  const target = new URL(self.registration.scope);
  target.searchParams.set("chatId", data.chatId);
  target.searchParams.set("messageId", data.messageId);

  await self.registration.showNotification(data.title || "New WhatsApp message", {
    body: data.body || "You have a new message.",
    tag: `whatsapp-${data.messageId}`,
    renotify: true,
    data: { url: target.href },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const appWindow = windows.find((client) => client.url.startsWith(self.registration.scope));

    if (appWindow) {
      await appWindow.navigate(targetUrl);
      await appWindow.focus();
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
