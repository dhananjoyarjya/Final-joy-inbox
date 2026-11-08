import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ContactRound, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteContact, listenToContacts, saveContact } from "../services/contacts";
import type { Chat, Contact } from "../types";

type Props = {
  userId: string;
  search: string;
  chats: Chat[];
  onOpenChat: (chat: Chat) => void;
};

type ContactForm = { name: string; phone: string; email: string; notes: string };
const emptyForm: ContactForm = { name: "", phone: "", email: "", notes: "" };

function phoneKey(value: string) {
  return value.replace(/\D/g, "");
}

export default function ContactsPanel({ userId, search, chats, onOpenChat }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = listenToContacts(
      userId,
      (items) => {
        setContacts(items);
        setLoading(false);
        setError("");
      },
      (listenerError) => {
        console.error("Contacts listener failed:", listenerError);
        setError("Contacts could not be loaded. Check Firestore access and connection.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [userId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return contacts.filter((contact) =>
      !term ||
      `${contact.name} ${contact.phone} ${contact.email || ""} ${contact.notes || ""}`
        .toLocaleLowerCase()
        .includes(term)
    );
  }, [contacts, search]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError("");
  }

  function startEdit(contact: Contact) {
    setEditing(contact);
    setFormOpen(true);
    setForm({
      name: contact.name || "",
      phone: contact.phone || "",
      email: contact.email || "",
      notes: contact.notes || "",
    });
    setError("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveContact(userId, editing?.id || null, {
        ...form,
        source: editing?.source || "local",
      });
      setEditing(null);
      setForm(emptyForm);
      setFormOpen(false);
    } catch (saveError) {
      console.error("Contact save failed:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Contact could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Delete ${contact.name} from saved contacts?`)) return;
    setError("");
    try {
      await deleteContact(userId, contact.id);
    } catch (deleteError) {
      console.error("Contact delete failed:", deleteError);
      setError(deleteError instanceof Error ? deleteError.message : "Contact could not be deleted.");
    }
  }

  return (
    <div className="contacts-page">
      <button type="button" className="contact-add-button" onClick={startCreate}>
        <Plus size={17} /> Add contact
      </button>
      {error && <p className="contacts-error" role="alert">{error}</p>}
      {loading ? (
        <div className="center-state"><Loader2 className="spin" size={20} />Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><ContactRound size={24} /></div>
          <h2>{contacts.length ? "No contacts match" : "No saved contacts"}</h2>
          <p>{contacts.length ? "Try a different name, phone number, or email." : "Add a customer contact or message your WhatsApp business number to sync a contact here."}</p>
        </div>
      ) : (
        filtered.map((contact) => {
          const chat = chats.find((item) => phoneKey(item.customerPhone) === phoneKey(contact.phone));
          return (
            <article className="contact-row" key={contact.id}>
              <span className="avatar">{(contact.name || contact.phone).slice(0, 1).toUpperCase()}</span>
              <div className="contact-row-main">
                <strong>{contact.name}</strong>
                <span>{contact.phone}</span>
                {contact.email && <span>{contact.email}</span>}
                <small>{contact.source === "whatsapp" ? "WhatsApp contact · details saved locally" : "Locally saved"}</small>
              </div>
              <div className="contact-actions">
                {chat ? (
                  <button type="button" className="contact-chat-button" onClick={() => onOpenChat(chat)} aria-label={`Open chat with ${contact.name}`}>
                    Open chat
                  </button>
                ) : (
                  <span className="no-contact-chat" title="A WhatsApp conversation appears after the customer messages your business">No chat</span>
                )}
                <button type="button" className="icon-button" onClick={() => startEdit(contact)} aria-label={`Edit ${contact.name}`} title="Edit contact">
                  <Pencil size={16} />
                </button>
                <button type="button" className="icon-button" onClick={() => handleDelete(contact)} aria-label={`Delete ${contact.name}`} title="Delete contact">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          );
        })
      )}

      {formOpen && (
        <div className="contact-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setFormOpen(false);
        }}>
          <form className="contact-modal" onSubmit={handleSave} aria-labelledby="contact-form-title">
            <header>
              <h2 id="contact-form-title">{editing ? "Edit contact" : "Add contact"}</h2>
              <button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Close contact form"><X size={18} /></button>
            </header>
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={100} required autoFocus />
            </label>
            <label>
              Phone number
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" placeholder="+14155552671" required />
              <small>Include the country code. Example: +1 415 555 2671</small>
            </label>
            <label>
              Email <span className="optional-label">Optional</span>
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" maxLength={254} />
            </label>
            <label>
              Notes <span className="optional-label">Optional</span>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={1000} rows={3} />
            </label>
            {error && <p className="contacts-error" role="alert">{error}</p>}
            <button type="submit" className="contact-save-button" disabled={saving}>
              {saving ? <Loader2 className="spin" size={17} /> : null}
              {saving ? "Saving…" : "Save contact"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
