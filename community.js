// Clubcom's realtime announcement wall and shared event calendar.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const format = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  let me;
  function makeCard(item, type) {
    const el = document.createElement("article"); el.className = "community-card";
    const h = document.createElement("h3"); h.textContent = item.title;
    const meta = document.createElement("p"); meta.className = "community-meta"; meta.textContent = format(type === "event" ? item.starts_at : item.created_at);
    const copy = document.createElement("p"); copy.className = "community-copy"; copy.textContent = type === "event" ? item.details : item.body;
    el.append(h, meta, copy);
    if (item.author_id === me) { const b = document.createElement("button"); b.type = "button"; b.className = "community-delete"; b.textContent = "Delete"; b.onclick = async () => { const { error } = await db.from(type === "event" ? "calendar_events" : "announcements").delete().eq("id", item.id); if (error) alert(error.message); else refresh(); }; el.append(b); }
    return el;
  }
  async function refresh() {
    const [a, e] = await Promise.all([
      db.from("announcements").select("id,author_id,title,body,created_at").order("created_at", { ascending: false }),
      db.from("calendar_events").select("id,author_id,title,details,starts_at").gte("starts_at", new Date().toISOString()).order("starts_at")
    ]);
    if (!a.error) { $("announcementsList").replaceChildren(...a.data.map((x) => makeCard(x, "announcement"))); $("announcementsEmpty").hidden = a.data.length > 0; }
    if (!e.error) { $("eventsList").replaceChildren(...e.data.map((x) => makeCard(x, "event"))); $("eventsEmpty").hidden = e.data.length > 0; }
  }
  async function start() {
    const { data } = await db.auth.getSession(); if (!data.session) return; me = data.session.user.id;
    $("announcementForm").onsubmit = async (ev) => { ev.preventDefault(); const title = $("announcementTitle").value.trim(), body = $("announcementBody").value.trim(); if (!title || !body) return; const { error } = await db.from("announcements").insert({ title, body }); if (error) return alert(error.message); ev.target.reset(); refresh(); };
    $("eventForm").onsubmit = async (ev) => { ev.preventDefault(); const title = $("eventTitle").value.trim(), starts_at = $("eventStart").value, details = $("eventDetails").value.trim(); if (!title || !starts_at) return; const { error } = await db.from("calendar_events").insert({ title, details, starts_at: new Date(starts_at).toISOString() }); if (error) return alert(error.message); ev.target.reset(); refresh(); };
    db.channel("clubcom-community").on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "calendar_events" }, refresh).subscribe();
    refresh();
  }
  start();
})();
