// Clubcom chat app: friends, 1-on-1 chats, group chats, live messages.
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const svg = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstChild; };
  const ICON_GROUP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.6"/><path d="M2 19.5c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8z"/><circle cx="17" cy="9" r="2.8"/><path d="M17 13.3c2.9 0 5 1.7 5 4.7h-4.4c-.2-1.9-1-3.4-2.3-4.5.5-.1 1.1-.2 1.7-.2z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  const COLORS = ["#1a7bd0", "#5da9e9", "#2e9e6b", "#d9822b", "#9b59b6", "#d6455d", "#1f9aa6", "#6a6fd8"];
  function colorFor(id) { let n = 0; for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return COLORS[n % COLORS.length]; }
  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function avatar(id, name, opts = {}) {
    if (opts.group) return h("span", { class: "avatar group" + (opts.sm ? " sm" : ""), "aria-hidden": "true" }, svg(ICON_GROUP));
    const a = h("span", { class: "avatar" + (opts.sm ? " sm" : ""), "aria-hidden": "true", text: initials(name) });
    a.style.background = colorFor(id);
    return a;
  }
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Someone";

  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
  function listTime(iso) {
    const d = new Date(iso), now = new Date();
    if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return "Yesterday";
    if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: "long" });
    return d.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
  }
  function sepTime(iso) {
    const d = new Date(iso), now = new Date();
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay(d, now)) return "Today " + t;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return "Yesterday " + t;
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " at " + t;
  }

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function errText(error) {
    const m = (error && error.message) || "Something went wrong. Try again.";
    return m.replace(/^.*?ERROR:\s*/i, "");
  }
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args || {});
    if (error) { toast(errText(error)); throw error; }
    return data;
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  const readKey = (id) => "clubcom:read:" + id;
  function getRead(id) { try { return localStorage.getItem(readKey(id)) || ""; } catch { return ""; } }
  function setRead(id, iso) { try { localStorage.setItem(readKey(id), iso || new Date().toISOString()); } catch { /* ignore */ } }

  // ---------- state ----------
  const state = {
    me: null,
    myName: "",
    tab: "chats",
    chats: [],
    friends: [],        // {id, full_name, relation: friend|sent|received}
    people: [],         // search results
    current: null,      // {id, name, is_group}
    members: [],        // [{id, full_name}]
    messages: [],
    names: new Map(),   // user id -> full name
  };
  const isPhone = () => window.matchMedia("(max-width: 899px)").matches;

  // ---------- tabs ----------
  function setTab(tab) {
    state.tab = tab;
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    $("tab-chats").hidden = tab !== "chats";
    $("tab-friends").hidden = tab !== "friends";
    $("tab-me").hidden = tab !== "me";
    $("sideTitle").textContent = { chats: "Chats", friends: "Friends", me: "Me" }[tab];
    $("composeBtn").hidden = tab !== "chats";
    if (tab === "friends") { refreshFriends(); searchPeople($("peopleSearch").value); }
  }
  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => setTab(b.dataset.tab));
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { closeSheet(); setTab(g.dataset.goto); }
  });

  // ---------- chats list ----------
  async function refreshChats() {
    const { data, error } = await db.rpc("chat_list");
    if (error) { toast(errText(error)); return; }
    state.chats = data || [];
    renderChatList();
    if (state.current) {
      const c = state.chats.find((x) => x.id === state.current.id);
      if (!c) closeChat();
      else if (!state.current.is_group || !state.current.name) { renderChatHeader(); }
    }
  }
  const refreshChatsSoon = debounce(refreshChats, 250);

  function isUnread(c) {
    if (!c.last_body || c.last_sender_id === state.me) return false;
    if (state.current && state.current.id === c.id) return false;
    const r = getRead(c.id);
    return !r || new Date(c.last_at) > new Date(r);
  }

  function renderChatList() {
    const ul = $("chatList");
    ul.replaceChildren();
    let unread = 0;
    for (const c of state.chats) {
      const un = isUnread(c);
      if (un) unread++;
      let preview = "No messages yet";
      if (c.last_body) {
        const who = c.last_sender_id === state.me ? "You: " : (c.is_group ? firstName(c.last_sender_name) + ": " : "");
        preview = who + c.last_body;
      }
      const otherId = c.is_group ? null : c.id;
      ul.append(h("li", {},
        h("button", {
          class: "row" + (state.current && state.current.id === c.id ? " active" : ""),
          type: "button",
          onclick: () => openChat(c.id),
        },
          un ? h("span", { class: "unread-dot", "aria-label": "Unread" }) : null,
          avatar(otherId || c.title, c.title, { group: c.is_group }),
          h("span", { class: "row-main" },
            h("span", { class: "row-top" },
              h("span", { class: "row-title", text: c.title }),
              h("span", { class: "row-time", text: listTime(c.last_at) })),
            h("span", { class: "row-sub", text: preview })))));
    }
    $("chatsEmpty").hidden = state.chats.length > 0;
    const badge = $("chatsBadge");
    badge.hidden = unread === 0;
    badge.textContent = unread;
  }

  // ---------- friends ----------
  async function refreshFriends() {
    const { data, error } = await db.rpc("my_friends");
    if (error) { toast(errText(error)); return; }
    state.friends = data || [];
    renderFriends();
  }

  function personRow(p, actions) {
    return h("li", {},
      h("div", { class: "row" },
        avatar(p.id, p.full_name),
        h("span", { class: "row-main" },
          h("span", { class: "row-top" },
            h("span", { class: "row-title", text: p.full_name || "Unnamed" }),
            h("span", { class: "actions" }, actions)))));
  }

  function actionsFor(p) {
    switch (p.relation) {
      case "friend":
        return [h("button", { class: "pill soft", type: "button", text: "Message", onclick: () => messageFriend(p.id) })];
      case "sent":
        return [h("button", { class: "pill muted", type: "button", text: "Requested", title: "Tap to cancel request",
          onclick: async (e) => { e.currentTarget.disabled = true; await rpc("remove_friend", { other: p.id }); afterFriendChange(); } })];
      case "received":
        return [
          h("button", { class: "pill", type: "button", text: "Accept",
            onclick: async (e) => { e.currentTarget.disabled = true; await rpc("respond_friend_request", { other: p.id, accept: true }); toast("You and " + firstName(p.full_name) + " are now friends"); afterFriendChange(); } }),
          h("button", { class: "pill soft", type: "button", text: "Decline",
            onclick: async (e) => { e.currentTarget.disabled = true; await rpc("respond_friend_request", { other: p.id, accept: false }); afterFriendChange(); } }),
        ];
      default:
        return [h("button", { class: "pill", type: "button", text: "Add",
          onclick: async (e) => { e.currentTarget.disabled = true; const r = await rpc("send_friend_request", { target: p.id }); toast(r === "friend" ? "You're now friends" : "Friend request sent to " + firstName(p.full_name)); afterFriendChange(); } })];
    }
  }

  function afterFriendChange() { refreshFriends(); searchPeople($("peopleSearch").value); }

  function renderFriends() {
    const requests = state.friends.filter((f) => f.relation === "received");
    const friends = state.friends.filter((f) => f.relation === "friend");
    $("requestsBlock").hidden = requests.length === 0;
    $("requestsList").replaceChildren(...requests.map((p) => personRow(p, actionsFor(p))));
    $("friendsBlock").hidden = friends.length === 0;
    $("friendsList").replaceChildren(...friends.map((p) => personRow(p, actionsFor(p))));
    const badge = $("friendsBadge");
    badge.hidden = requests.length === 0;
    badge.textContent = requests.length;
    for (const f of state.friends) state.names.set(f.id, f.full_name);
  }

  let searchSeq = 0;
  async function searchPeople(q) {
    const seq = ++searchSeq;
    const { data, error } = await db.rpc("search_people", { q: q || "" });
    if (seq !== searchSeq) return;
    if (error) { toast(errText(error)); return; }
    // Friends and incoming requests already have their own sections.
    state.people = (data || []).filter((p) => p.relation === "none" || p.relation === "sent");
    $("peopleList").replaceChildren(...state.people.map((p) => personRow(p, actionsFor(p))));
    $("peopleEmpty").hidden = state.people.length > 0;
    $("peopleEmpty").textContent = (q || "").trim()
      ? "No one new matches “" + q.trim() + "”."
      : "Everyone on Clubcom is already your friend. Invite more people to sign up!";
  }
  $("peopleSearch").addEventListener("input", debounce((e) => searchPeople(e.target.value), 250));

  async function messageFriend(id) {
    const conv = await rpc("start_chat", { member_ids: [id], chat_name: null });
    await refreshChats();
    setTab("chats");
    openChat(conv);
  }

  // ---------- open chat ----------
  async function openChat(id) {
    const [conv, mem, msgs] = await Promise.all([
      db.from("conversations").select("id, name, is_group").eq("id", id).single(),
      db.from("conversation_members").select("user_id, profiles(full_name)").eq("conversation_id", id),
      db.from("messages").select("id, conversation_id, sender_id, body, created_at")
        .eq("conversation_id", id).order("created_at", { ascending: false }).limit(300),
    ]);
    if (conv.error) { toast("That chat isn't available anymore."); refreshChats(); return; }
    state.current = conv.data;
    state.members = (mem.data || []).map((r) => ({ id: r.user_id, full_name: (r.profiles && r.profiles.full_name) || "Someone" }));
    for (const m of state.members) state.names.set(m.id, m.full_name);
    state.messages = (msgs.data || []).reverse();
    await fillMissingNames(state.messages.map((m) => m.sender_id));

    $("paneEmpty").hidden = true;
    $("chat").hidden = false;
    renderChatHeader();
    renderMessages(true);
    markRead();
    renderChatList();

    if (isPhone()) {
      if ($("app").dataset.view !== "chat") history.pushState({ chat: id }, "");
      $("app").dataset.view = "chat";
    } else {
      $("messageInput").focus();
    }
  }

  async function fillMissingNames(ids) {
    const missing = [...new Set(ids)].filter((x) => x && !state.names.has(x));
    if (!missing.length) return;
    const { data } = await db.from("profiles").select("id, full_name").in("id", missing);
    for (const p of data || []) state.names.set(p.id, p.full_name);
  }

  function chatTitle() {
    const c = state.current;
    if (!c) return "";
    if (c.name) return c.name;
    const others = state.members.filter((m) => m.id !== state.me);
    if (!others.length) return "Just you";
    if (!c.is_group) return others[0].full_name;
    return others.map((m) => firstName(m.full_name)).join(", ");
  }

  function renderChatHeader() {
    const c = state.current;
    if (!c) return;
    const others = state.members.filter((m) => m.id !== state.me);
    const title = chatTitle();
    $("chatTitle").textContent = title;
    $("chatSub").textContent = c.is_group ? state.members.length + " people" : "";
    const av = c.is_group ? avatar(null, title, { group: true, sm: true }) : avatar(others[0] ? others[0].id : title, title, { sm: true });
    av.id = "chatAvatar";
    $("chatAvatar").replaceWith(av);
    document.title = title + " · Clubcom";
  }

  function closeChat() {
    state.current = null;
    state.members = [];
    state.messages = [];
    $("chat").hidden = true;
    $("paneEmpty").hidden = false;
    $("app").dataset.view = "list";
    document.title = "Chats · Clubcom";
    renderChatList();
  }

  $("backBtn").addEventListener("click", () => {
    if (history.state && history.state.chat) history.back();
    else closeChat();
  });
  window.addEventListener("popstate", () => { if ($("app").dataset.view === "chat") closeChat(); });

  function markRead() {
    if (!state.current) return;
    const last = state.messages[state.messages.length - 1];
    setRead(state.current.id, last ? last.created_at : new Date().toISOString());
  }

  // ---------- messages ----------
  const GAP = 15 * 60 * 1000;
  function renderMessages(forceBottom, newestId) {
    const box = $("messages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.replaceChildren();
    const msgs = state.messages;
    if (!msgs.length) {
      box.append(h("div", { class: "time-sep", text: state.current && state.current.is_group
        ? "This is the start of your group chat. Say hi!"
        : "This is the start of your chat. Say hi!" }));
    }
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i], prev = msgs[i - 1], next = msgs[i + 1];
      const t = new Date(m.created_at).getTime();
      const newBlock = !prev || t - new Date(prev.created_at).getTime() > GAP;
      if (newBlock) box.append(h("div", { class: "time-sep", text: sepTime(m.created_at) }));
      const mine = m.sender_id === state.me;
      const runStart = newBlock || prev.sender_id !== m.sender_id;
      const runEnd = !next || next.sender_id !== m.sender_id || new Date(next.created_at).getTime() - t > GAP;
      if (!mine && runStart && state.current && state.current.is_group) {
        box.append(h("div", { class: "sender", text: state.names.get(m.sender_id) || "Someone" }));
      }
      box.append(h("div", {
        class: "bubble " + (mine ? "me" : "them") + (runEnd ? " tail" : "") + (m._sending ? " sending" : "") + (m.id === newestId ? " new" : ""),
        title: new Date(m.created_at).toLocaleString(),
        text: m.body,
      }));
    }
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
  }

  async function onIncoming(m) {
    if (state.current && m.conversation_id === state.current.id) {
      if (!state.messages.some((x) => x.id === m.id)) {
        // Replace my own pending copy if this is it.
        const pending = state.messages.findIndex((x) => x._sending && x.sender_id === m.sender_id && x.body === m.body);
        if (pending >= 0) state.messages.splice(pending, 1);
        await fillMissingNames([m.sender_id]);
        state.messages.push(m);
        renderMessages(m.sender_id === state.me, m.id);
        if (!document.hidden) markRead();
      }
    }
    refreshChatsSoon();
  }

  // ---------- composer ----------
  const input = $("messageInput");
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight + 2, 140) + "px"; $("sendBtn").disabled = !input.value.trim(); }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !state.current) return;
    const convId = state.current.id;
    input.value = "";
    autosize();
    const temp = { id: "tmp" + Date.now(), conversation_id: convId, sender_id: state.me, body, created_at: new Date().toISOString(), _sending: true };
    state.messages.push(temp);
    renderMessages(true, temp.id);

    const { data, error } = await db.from("messages").insert({ conversation_id: convId, body })
      .select("id, conversation_id, sender_id, body, created_at").single();
    const idx = state.messages.indexOf(temp);
    if (error) {
      if (idx >= 0) state.messages.splice(idx, 1);
      renderMessages(true);
      if (!input.value) { input.value = body; autosize(); }
      toast("Message didn't send. " + errText(error));
      return;
    }
    if (state.current && state.current.id === convId) {
      if (idx >= 0) {
        if (state.messages.some((x) => x.id === data.id)) state.messages.splice(idx, 1);
        else state.messages[idx] = data;
      }
      renderMessages(true);
      markRead();
    }
    refreshChatsSoon();
  });

  // ---------- sheets ----------
  function openSheet(...content) {
    $("sheet").replaceChildren(...content);
    $("sheetBackdrop").hidden = false;
  }
  function closeSheet() { $("sheetBackdrop").hidden = true; $("sheet").replaceChildren(); }
  $("sheetBackdrop").addEventListener("click", (e) => { if (e.target === $("sheetBackdrop")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheetBackdrop").hidden) closeSheet(); });

  // Pick friends: used for "New Message" and "Add People".
  function openPicker({ title, actionLabel, exclude = new Set(), allowName = false, onDone }) {
    const friends = state.friends.filter((f) => f.relation === "friend" && !exclude.has(f.id));
    const picked = new Set();
    const action = h("button", { class: "text-btn strong", type: "button", text: actionLabel, disabled: true });
    const toRow = h("div", { class: "to-row" });
    const nameInput = h("input", { type: "text", placeholder: "Group name (optional)", maxlength: "60", "aria-label": "Group name" });
    const nameRow = h("div", { class: "field-row", hidden: true }, nameInput);

    function refresh() {
      toRow.replaceChildren(h("span", { text: "To:" }),
        ...[...picked].map((id) => h("span", { class: "chip", text: firstName(state.names.get(id)) })));
      action.disabled = picked.size === 0;
      nameRow.hidden = !(allowName && picked.size >= 2);
    }

    const list = h("ul", { class: "list" }, friends.map((f) => {
      const row = h("button", { class: "row", type: "button", role: "checkbox", "aria-checked": "false",
        onclick: () => {
          if (picked.has(f.id)) picked.delete(f.id); else picked.add(f.id);
          row.setAttribute("aria-checked", String(picked.has(f.id)));
          refresh();
        } },
        avatar(f.id, f.full_name),
        h("span", { class: "row-main" }, h("span", { class: "row-title", text: f.full_name })),
        h("span", { class: "check" }, svg(ICON_CHECK)));
      return h("li", {}, row);
    }));

    action.addEventListener("click", async () => {
      action.disabled = true;
      try { await onDone([...picked], nameInput.value.trim()); closeSheet(); }
      catch { action.disabled = false; }
    });

    const body = friends.length
      ? h("div", { class: "sheet-body" }, toRow, nameRow, h("h3", { class: "section-label", text: "Friends" }), list)
      : h("div", { class: "sheet-body" }, h("div", { class: "empty" },
          h("strong", { text: exclude.size ? "No more friends to add" : "No friends yet" }),
          h("span", { text: "You can only chat with friends. Find people and send them a request first." }),
          h("button", { class: "pill", type: "button", "data-goto": "friends", text: "Find friends" })));

    openSheet(
      h("div", { class: "sheet-head" },
        h("button", { class: "text-btn", type: "button", text: "Cancel", onclick: closeSheet }),
        h("h2", { text: title }),
        action),
      body);
    refresh();
  }

  $("composeBtn").addEventListener("click", async () => {
    await refreshFriends();
    openPicker({
      title: "New Message",
      actionLabel: "Start",
      allowName: true,
      onDone: async (ids, name) => {
        const conv = await rpc("start_chat", { member_ids: ids, chat_name: ids.length > 1 ? (name || null) : null });
        await refreshChats();
        openChat(conv);
      },
    });
  });

  function openInfo() {
    const c = state.current;
    if (!c) return;
    const others = state.members.filter((m) => m.id !== state.me);
    const parts = [];

    if (c.is_group) {
      const nameInput = h("input", { type: "text", maxlength: "60", placeholder: "Group name", value: c.name || "", "aria-label": "Group name" });
      parts.push(h("h3", { class: "section-label", text: "Group name" }),
        h("form", { class: "field-row", onsubmit: async (e) => {
          e.preventDefault();
          await rpc("rename_chat", { conv: c.id, new_name: nameInput.value });
          state.current.name = nameInput.value.trim() || null;
          renderChatHeader();
          refreshChats();
          toast("Group name saved");
        } }, nameInput, h("button", { class: "pill", type: "submit", text: "Save" })));
    }

    parts.push(h("h3", { class: "section-label", text: state.members.length + (state.members.length === 1 ? " person" : " people") }),
      h("ul", { class: "list" }, state.members.map((m) => h("li", {},
        h("div", { class: "row" }, avatar(m.id, m.full_name),
          h("span", { class: "row-main" }, h("span", { class: "row-title", text: m.id === state.me ? m.full_name + " (you)" : m.full_name })))))));

    parts.push(h("button", { class: "block-btn", type: "button", text: "Add People", onclick: async () => {
      await refreshFriends();
      openPicker({
        title: "Add People",
        actionLabel: "Add",
        exclude: new Set(state.members.map((m) => m.id)),
        onDone: async (ids) => {
          if (c.is_group) {
            await rpc("add_chat_members", { conv: c.id, member_ids: ids });
            toast(ids.length === 1 ? "Added " + firstName(state.names.get(ids[0])) : "Added " + ids.length + " people");
            openChat(c.id);
          } else {
            // Like iMessage: adding people to a 1-on-1 starts a new group chat.
            const conv = await rpc("start_chat", { member_ids: [...others.map((o) => o.id), ...ids], chat_name: null });
            await refreshChats();
            openChat(conv);
            toast("Started a new group chat");
          }
        },
      });
    } }));

    const leave = h("button", { class: "block-btn danger", type: "button", text: c.is_group ? "Leave this Chat" : "Delete Chat" });
    let armed = false;
    leave.addEventListener("click", async () => {
      if (!armed) { armed = true; leave.textContent = "Tap again to confirm"; return; }
      leave.disabled = true;
      await rpc("leave_chat", { conv: c.id });
      closeSheet();
      if (history.state && history.state.chat) history.back();
      closeChat();
      refreshChats();
    });
    parts.push(leave);

    openSheet(
      h("div", { class: "sheet-head" },
        h("span"),
        h("h2", { text: chatTitle() }),
        h("button", { class: "text-btn strong", type: "button", text: "Done", onclick: closeSheet })),
      h("div", { class: "sheet-body" }, parts));
  }
  $("infoBtn").addEventListener("click", openInfo);
  $("titleBtn").addEventListener("click", openInfo);

  // ---------- me ----------
  function renderMe() {
    const av = avatar(state.me, state.myName);
    av.id = "meAvatar";
    $("meAvatar").replaceWith(av);
    $("meName").textContent = state.myName;
    $("nameInput").value = state.myName;
  }
  $("nameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) { toast("Enter a name."); return; }
    const { error } = await db.from("profiles").update({ full_name: name }).eq("id", state.me);
    if (error) { toast(errText(error)); return; }
    state.myName = name;
    state.names.set(state.me, name);
    renderMe();
    toast("Name saved");
  });
  $("logoutBtn").addEventListener("click", async () => { await db.auth.signOut(); location.replace("/"); });

  // ---------- live updates ----------
  function subscribe() {
    db.channel("clubcom-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => onIncoming(p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => {
        refreshFriends();
        if (state.tab === "friends") searchPeople($("peopleSearch").value);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        refreshChatsSoon();
        if (state.current) {
          db.from("conversation_members").select("user_id, profiles(full_name)").eq("conversation_id", state.current.id)
            .then(({ data }) => {
              if (!data || !state.current) return;
              state.members = data.map((r) => ({ id: r.user_id, full_name: (r.profiles && r.profiles.full_name) || "Someone" }));
              for (const m of state.members) state.names.set(m.id, m.full_name);
              renderChatHeader();
            });
        }
      })
      .subscribe();
    // Safety net in case the live connection drops.
    setInterval(() => { if (!document.hidden) refreshChats(); }, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { refreshChats(); if (state.current) { markRead(); } }
    });
  }

  // ---------- start ----------
  async function start() {
    const { data } = await db.auth.getSession();
    if (!data.session) { location.replace("/login.html"); return; }
    state.me = data.session.user.id;
    const meta = data.session.user.user_metadata || {};
    const { data: prof } = await db.from("profiles").select("full_name").eq("id", state.me).maybeSingle();
    state.myName = (prof && prof.full_name) || meta.full_name || data.session.user.email.split("@")[0];
    state.names.set(state.me, state.myName);
    renderMe();
    await Promise.all([refreshChats(), refreshFriends()]);
    subscribe();
  }
  db.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.replace("/"); });
  start();
})();
