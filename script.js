// ==========================================================
// 1. SETTINGS (links and keys are in config.js)
// ==========================================================
// Your links and keys are in config.js. Only the column layout of your Sheet tabs is here.
// Column numbers in the published MEMBERS tab (0 = first column).
const COLS = { name: 0, section: 1, teach: 2, learn: 3, days: 4, mode: 5, username: 6, pinHash: 7 };

// Columns of the Requests tab (column A is the timestamp).
const REQUEST_COLS = { time: 0, to: 1, from: 2, fromName: 3, skills: 4, message: 5, contact: 6 };


// Shared state (DEMO_DATA comes from data.js, which loads first)
let people = [];       // every student loaded from the Sheet
let allSkills = [];    // every skill name, for the chips and filters
let lastResults = [];  // the most recent match results
let requests = [];     // every swap request loaded from the Requests tab
let approvedSkills = [];   // skills you approved (from the "Approved skills" tab)
let pendingRequest = null;  // the match the person is sending a request to
let currentUser = JSON.parse(localStorage.getItem("bb_user") || "null");  // the signed-in person
localStorage.removeItem("bb_contact");   // old shared keys (they mixed up accounts on one device)
localStorage.removeItem("bb_sent");

// Skill-request settings come from config.js (empty if config.js is an older copy)
const SKILL_REQ_URL = typeof SKILL_REQUEST_POST_URL === "undefined" ? "" : SKILL_REQUEST_POST_URL;
const SKILL_REQ_ENTRY = typeof SKILL_REQUEST_ENTRY === "undefined" ? {} : SKILL_REQUEST_ENTRY;
const APPROVED_URL = typeof APPROVED_SKILLS_CSV_URL === "undefined" ? "" : APPROVED_SKILLS_CSV_URL;

// Page elements we use often
const el = {
  stats: document.getElementById("stats"),
  searchBox: document.getElementById("searchBox"),
  skillFilter: document.getElementById("skillFilter"),
  dayFilter: document.getElementById("dayFilter"),
  cards: document.getElementById("cards"),
  matchBtn: document.getElementById("matchBtn"),
  mutualOnly: document.getElementById("mutualOnly"),
  matchMsg: document.getElementById("matchMsg"),
  results: document.getElementById("results"),
  radarList: document.getElementById("radarList")
};

// ==========================================================
// 2. SMALL HELPERS
// ==========================================================
function esc(text) {            // stops pasted HTML from running on the page
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");   // quotes too, so it is safe inside attributes
}
function firstName(name) { return (name || "").trim().split(/\s+/)[0]; }   // only first names are shown to other people
function label(skill) { return skill.charAt(0).toUpperCase() + skill.slice(1); }
function toList(cell) { return cell.split(",").map(s => s.trim().toLowerCase()).filter(Boolean); }
// Contact and "already requested" are saved PER ACCOUNT, so two accounts on one device never mix
function getContact() { return currentUser ? localStorage.getItem("bb_contact_" + currentUser.username) || "" : ""; }
function setContact(username, value) { localStorage.setItem("bb_contact_" + username, value); }
function sentKey() { return "bb_sent_" + (currentUser ? currentUser.username : ""); }
function chipsHTML(list, extraClass) {
  return list.map(s => `<span class="chip ${extraClass}">${esc(label(s))}</span>`).join("");
}

// ==========================================================
// 3. LOADING THE DATA
// ==========================================================
function parseCSV(text) {       // handles "quoted, cells" from Google Sheets
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function rowsToPeople(rows) {
  const list = [];
  const byUsername = {};   // username -> the person already in the list
  for (const r of rows.slice(1)) {
    if (!r[COLS.name]) continue;
    const person = {
      name: r[COLS.name].trim(),
      section: (r[COLS.section] || "").trim(),
      teach: toList(r[COLS.teach] || ""),
      learn: toList(r[COLS.learn] || ""),
      days: (r[COLS.days] || "").split(",").map(d => d.trim().slice(0, 3)).filter(Boolean),
      mode: (r[COLS.mode] || "").trim(),
      username: (r[COLS.username] || "").trim().toLowerCase(),
      pinHash: (r[COLS.pinHash] || "").trim()
    };
    const existing = person.username ? byUsername[person.username] : null;
    if (!existing) {
      list.push(person);
      if (person.username) byUsername[person.username] = person;
    } else if (existing.pinHash === person.pinHash) {
      Object.assign(existing, person);   // same username + same password hash = a profile update, newest row wins
    }
    // a row that reuses a taken username with a different password hash is ignored
  }
  return list;
}

async function loadData() {
  if (!SHEET_CSV_URL) return DEMO_DATA;
  try {
    const separator = SHEET_CSV_URL.includes("?") ? "&" : "?";   // links that already have a ? need &
    const response = await fetch(SHEET_CSV_URL + separator + "t=" + Date.now());   // t= avoids old cached data
    const text = await response.text();
    if (!response.ok || text.trim().startsWith("<")) {
      throw new Error("The link did not return CSV data");
    }
    return rowsToPeople(parseCSV(text));
  } catch (error) {
    console.error("Could not load the Sheet, using demo data:", error);
    return DEMO_DATA;
  }
}

async function loadApprovedSkills() {   // skills you approved, one per row in column A
  if (!APPROVED_URL) return [];
  try {
    const separator = APPROVED_URL.includes("?") ? "&" : "?";
    const response = await fetch(APPROVED_URL + separator + "t=" + Date.now());
    const text = await response.text();
    if (!response.ok || text.trim().startsWith("<")) throw new Error("The link did not return CSV data");
    return parseCSV(text).slice(1).map(r => cleanSkill(r[0] || "")).filter(Boolean);
  } catch (error) {
    console.error("Could not load approved skills:", error);
    return [];
  }
}

function computeSkills() {   // official list + approved requests + the signed-in person's own skills (so editing never loses them)
  const own = currentUser ? (currentUser.teach || []).concat(currentUser.learn || []) : [];
  return [...new Set(SKILLS.concat(approvedSkills, own))].sort();
}

// ==========================================================
// 4. MATCHING (the core logic)
// ==========================================================
function findMatches(me, everyone) {
  const results = [];
  for (const other of everyone) {
    if (other.name === me.name || (me.username && other.username === me.username)) continue;
    const theyCanTeachMe = other.teach.filter(s => me.learn.includes(s));
    const iCanTeachThem = me.teach.filter(s => other.learn.includes(s));
    const sharedDays = other.days.filter(d => me.days.includes(d));
    if (theyCanTeachMe.length === 0 && iCanTeachThem.length === 0) continue;

    const isMutual = theyCanTeachMe.length > 0 && iCanTeachThem.length > 0;
    let score = (theyCanTeachMe.length + iCanTeachThem.length) * 2 + sharedDays.length;
    if (isMutual) score += 10;
    results.push({ person: other, theyCanTeachMe, iCanTeachThem, sharedDays, isMutual, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ==========================================================
// 5. SHOWING THINGS ON THE PAGE
// ==========================================================

// ----- Home stats -----
function canSwap(a, b) {
  const aTeachesB = a.teach.some(skill => b.learn.includes(skill));
  const bTeachesA = b.teach.some(skill => a.learn.includes(skill));
  return aTeachesB && bTeachesA;
}

function countMutualPairs() {
  let count = 0;
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (canSwap(people[i], people[j])) count++;
    }
  }
  return count;
}

function renderStats() {
  el.stats.textContent =
    `${people.length} students, ${allSkills.length} skills, ${countMutualPairs()} possible mutual swaps.`;
}

// ----- Browse section -----
function personCard(person) {
  return `<article class="card">
    <h3>${esc(firstName(person.name))}</h3>
    <div class="meta">${esc(person.section)} | ${esc(person.days.join(", "))} | ${esc(person.mode)}</div>
    <div><strong>Teaches:</strong><br>${chipsHTML(person.teach, "")}</div>
    <div><strong>Wants:</strong><br>${chipsHTML(person.learn, "want")}</div>
  </article>`;
}

function matchesFilters(person, skill, day, query) {
  const skillOk = skill === "all" || person.teach.includes(skill) || person.learn.includes(skill);
  const dayOk = day === "all" || person.days.includes(day);
  const text = [firstName(person.name), person.section].concat(person.teach, person.learn).join(" ").toLowerCase();
  const queryOk = !query || text.includes(query);
  return skillOk && dayOk && queryOk;
}

function renderBrowse() {
  const skill = el.skillFilter.value;
  const day = el.dayFilter.value;
  const query = el.searchBox.value.trim().toLowerCase();
  const shown = people.filter(person => matchesFilters(person, skill, day, query));

  el.cards.innerHTML = shown.length
    ? shown.map(personCard).join("")
    : "<p>No one matches those filters yet. Be the first to join!</p>";
}

// ----- Find matches section -----
function matchCard(result, index) {
  const { person, theyCanTeachMe, iCanTeachThem, sharedDays, isMutual } = result;

  const badgeText = isMutual ? "Mutual swap!" : "One-way match";
  const sharedText = sharedDays.length ? esc(sharedDays.join(", ")) : "none yet";
  const teachMe = theyCanTeachMe.length
    ? `<div>They can teach you:<br>${chipsHTML(theyCanTeachMe, "")}</div>` : "";
  const teachThem = iCanTeachThem.length
    ? `<div>You can teach them:<br>${chipsHTML(iCanTeachThem, "want")}</div>` : "";

  return `<article class="card ${isMutual ? "mutual" : ""}">
    <span class="badge ${isMutual ? "" : "oneway"}">${badgeText}</span>
    <h3>${esc(firstName(person.name))}</h3>
    <div class="meta">${esc(person.section)} | Shared days: ${sharedText}</div>
    ${teachMe}
    ${teachThem}
    <button class="btn small" type="button" data-index="${index}">${sentTo().includes(person.username) ? "Request again" : "Request intro"}</button>
  </article>`;
}

function renderMatches() {
  const me = { name: "(you)", username: currentUser ? currentUser.username : "",
               teach: getChecked("teach"), learn: getChecked("learn"), days: getChecked("day") };

  if (me.teach.length === 0 && me.learn.length === 0) {
    el.matchMsg.textContent = "Pick at least one skill to teach or learn.";
    el.results.innerHTML = "";
    return;
  }

  const found = findMatches(me, people);
  const mutualCount = found.filter(result => result.isMutual).length;
  lastResults = el.mutualOnly.checked ? found.filter(result => result.isMutual) : found;   // must be the list on screen (buttons use its index)

  if (lastResults.length) {
    el.matchMsg.textContent = `${lastResults.length} match(es) found, ${mutualCount} mutual swap(s).`;
  } else if (found.length) {
    el.matchMsg.textContent = "No mutual swaps yet. Turn off Mutual swaps only to see one-way matches.";
  } else {
    el.matchMsg.textContent = "No matches yet. Check the Skill radar to see which skills are needed.";
  }
  el.results.innerHTML = lastResults.map(matchCard).join("");
}


// ----- Skill radar -----
function addCount(counts, skill, kind) {
  if (!counts[skill]) counts[skill] = { want: 0, teach: 0 };
  counts[skill][kind]++;
}

function countSkills() {
  const counts = {};
  for (const person of people) {
    for (const skill of person.learn) addCount(counts, skill, "want");
    for (const skill of person.teach) addCount(counts, skill, "teach");
  }
  return counts;
}

function radarRow(row, max) {
  const barWidth = (row.want / max) * 100;
  const needsTeacher = row.teach === 0;
  const note = needsTeacher ? "needs a teacher!" : `${row.teach} teach`;

  return `<button type="button" class="radar-row" data-skill="${esc(row.skill)}">
    <strong>${esc(label(row.skill))}</strong>
    <div class="bar"><div style="width:${barWidth}%"></div></div>
    <span class="note ${needsTeacher ? "need" : ""}">${row.want} want, ${note}</span>
  </button>`;
}

function renderRadar() {
  const counts = countSkills();
  const rows = Object.keys(counts)
    .map(skill => ({ skill: skill, want: counts[skill].want, teach: counts[skill].teach }))
    .filter(row => row.want > 0)
    .sort((a, b) => b.want - a.want)
    .slice(0, 8);
  const max = rows.length ? rows[0].want : 1;

  el.radarList.innerHTML = rows.length
    ? rows.map(row => radarRow(row, max)).join("")
    : "<p>No data yet.</p>";
}

// ==========================================================
// 6. ACCOUNTS (sign up, log in, log out)
// ==========================================================
async function sha256(text) {   // scrambles text so the raw PIN is never sent or stored
  const bytes = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
  return "h" + hex;             // the "h" stops Sheets from treating it like a number
}
function pinHashOf(username, pin) { return sha256(`${SALT}|${username}|${pin}`); }

function updateAuthUI() {
  const signedIn = currentUser !== null;
  document.getElementById("authForms").hidden = signedIn;
  document.getElementById("welcome").hidden = !signedIn;
  document.querySelectorAll(".members-only").forEach(item => item.hidden = !signedIn);
  if (signedIn) document.getElementById("welcomeName").textContent = firstName(currentUser.name);
  document.getElementById("startBtn").href = signedIn ? "#matches" : "#join";
  document.querySelectorAll(".guest-only").forEach(item => item.hidden = signedIn);
  document.body.classList.toggle("signed-in", signedIn);
  allSkills = computeSkills();
  buildAllChips();
  renderInbox();
  prefillMatches();
  showView();
}

function signOut() {
  currentUser = null;
  localStorage.removeItem("bb_user");
  updateAuthUI();
}

// ----- Sign-up steps (1 = account details, 2 = skills and schedule) -----
function setSignupStep(step) {
  document.getElementById("signupStep1").hidden = step !== 1;
  document.getElementById("signupStep2").hidden = step !== 2;
  document.getElementById("signupBar").style.width = (step * 50) + "%";
  document.getElementById("signupStepLabel").textContent = `Step ${step} of 2`;
  document.getElementById("signupMsg1").textContent = "";
  document.getElementById("signupMsg").textContent = "";
  window.scrollTo(0, 0);
}

function showAuthForm(which) {   // "signup" or "signin"
  document.getElementById("signupForm").hidden = which !== "signup";
  document.getElementById("signinForm").hidden = which !== "signin";
  window.scrollTo(0, 0);
}

function continueSignup() {      // checks step 1, then opens step 2
  const form = document.getElementById("signupForm");
  const msg = document.getElementById("signupMsg1");
  const fields = [...document.querySelectorAll("#signupStep1 input")];
  const bad = fields.find(field => !field.checkValidity());
  if (bad) { bad.reportValidity(); return; }

  const email = form.email.value.trim().toLowerCase();
  const username = form.username.value.trim().toLowerCase();
  if (!email.endsWith(SCHOOL_DOMAIN)) {
    msg.textContent = `Please use your school email (${SCHOOL_DOMAIN}).`;
    return;
  }
  if (people.some(p => p.username === username)) {
    msg.textContent = "That username is taken. Try another one.";
    return;
  }
  setSignupStep(2);
}

async function handleSignup(event) {
  event.preventDefault();
  if (!document.getElementById("signupStep1").hidden) { continueSignup(); return; }   // Enter on step 1 = Continue
  const form = event.target;
  const msg = document.getElementById("signupMsg");
  const teach = getChecked("joinTeach"), learn = getChecked("joinLearn");
  const days = getChecked("joinDays"), mode = getChecked("joinMode")[0];
  const email = form.email.value.trim().toLowerCase();
  const username = form.username.value.trim().toLowerCase();

  if (!email.endsWith(SCHOOL_DOMAIN) || people.some(p => p.username === username)) {
    setSignupStep(1);   // something in step 1 needs fixing
    continueSignup();
    return;
  }
  if (teach.length === 0 && learn.length === 0) {
    msg.textContent = "Pick at least one skill to teach or learn.";
    return;
  }
  if (days.length === 0 || !mode) {
    msg.textContent = "Pick your free days and a mode.";
    return;
  }

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  msg.textContent = "Creating your account...";

  const contact = form.contact.value.trim();
  const profile = {
    name: form.fullName.value.trim(), section: form.section.value.trim(),
    teach, learn, days, mode, username
  };

  try {
    const pinHash = await pinHashOf(username, form.pin.value);
    const data = new URLSearchParams();
    data.append(ENTRY.name, profile.name);
    data.append(ENTRY.section, profile.section);
    data.append(ENTRY.teach, teach.join(", "));
    data.append(ENTRY.learn, learn.join(", "));
    data.append(ENTRY.days, days.join(", "));
    data.append(ENTRY.mode, mode);
    data.append(ENTRY.contact, contact);
    data.append(ENTRY.email, email);
    data.append(ENTRY.username, username);
    data.append(ENTRY.pinHash, pinHash);

    await fetch(FORM_POST_URL, { method: "POST", mode: "no-cors", body: data });

    people.push({ ...profile, pinHash });          // show them on the site right away
    currentUser = { ...profile, pinHash };         // and sign them in
    localStorage.setItem("bb_user", JSON.stringify(currentUser));
    setContact(currentUser.username, contact);   // saved only on this device

    form.reset();
    setSignupStep(1);
    updateAuthUI();
    renderStats(); renderBrowse(); renderRadar();
  } catch (error) {
    console.error(error);
    msg.textContent = "Something went wrong. Check your connection and try again.";
  }
  button.disabled = false;
}

async function handleSignin(event) {
  event.preventDefault();
  const form = event.target;
  const msg = document.getElementById("signinMsg");
  msg.textContent = "Checking...";

  try {
    const username = form.username.value.trim().toLowerCase();
    const pinHash = await pinHashOf(username, form.pin.value);
    const found = people.find(p => p.username === username && p.pinHash === pinHash);

    if (!found) {
      msg.textContent = "No match. Check your username and password. If you just signed up on another device, wait a few minutes and try again.";
      return;
    }
    currentUser = { name: found.name, section: found.section, teach: found.teach,
                    learn: found.learn, days: found.days, mode: found.mode, username: found.username,
                    pinHash: found.pinHash };
    localStorage.setItem("bb_user", JSON.stringify(currentUser));
    form.reset();
    msg.textContent = "";
    updateAuthUI();
  } catch (error) {
    console.error(error);
    msg.textContent = "Could not log in. Open the site with Live Server or a web link, not by double-clicking the file.";
  }
}

function connectAccounts() {
  document.getElementById("signupForm").addEventListener("submit", handleSignup);
  document.getElementById("signinForm").addEventListener("submit", handleSignin);
  document.getElementById("signOutBtn").addEventListener("click", signOut);
  document.getElementById("requestForm").addEventListener("submit", sendRequest);
  document.getElementById("reqCancel").addEventListener("click", () => document.getElementById("requestDialog").close());
  document.getElementById("editProfileBtn").addEventListener("click", openEditProfile);
  document.getElementById("editForm").addEventListener("submit", saveProfile);
  document.getElementById("editCancel").addEventListener("click", () => document.getElementById("editDialog").close());
  // Dropdowns: Account (Manage account / Log out) and Request a skill. Only one is open at a time,
  // and the rest of the page dims while one is open.
  const backdrop = document.getElementById("menuBackdrop");
  const menus = {
    account: { button: document.getElementById("accountBtn"), panel: document.getElementById("accountDropdown") },
    request: { button: document.getElementById("navRequestBtn"), panel: document.getElementById("requestPanel") }
  };
  const openMenu = which => {   // which = "account", "request" or null (close everything)
    for (const [name, menu] of Object.entries(menus)) {
      menu.panel.hidden = name !== which;
      menu.button.setAttribute("aria-expanded", String(name === which));
    }
    backdrop.classList.toggle("open", Boolean(which));
    document.body.classList.toggle("menu-open", Boolean(which));
    if (which === "request") menus.request.panel.querySelector("input").focus();
  };
  for (const [name, menu] of Object.entries(menus)) {
    menu.button.addEventListener("click", () => openMenu(menu.panel.hidden ? name : null));
  }
  document.addEventListener("click", event => {
    if (!event.target.closest("#accountBtn, #accountDropdown, #navRequestBtn, #requestPanel")) openMenu(null);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") openMenu(null); });
  menus.account.panel.querySelector("a").addEventListener("click", () => openMenu(null));
  document.getElementById("menuSignOut").addEventListener("click", () => { openMenu(null); signOut(); location.hash = "#home"; });
  document.querySelectorAll("[data-auth]").forEach(link =>   // Login / Sign up buttons open the right form
    link.addEventListener("click", () => showAuthForm(link.dataset.auth)));
  document.getElementById("signupNext").addEventListener("click", continueSignup);
  document.getElementById("signupBack").addEventListener("click", () => setSignupStep(1));
  document.querySelectorAll("[data-switch]").forEach(link =>
    link.addEventListener("click", () => showAuthForm(link.dataset.switch)));
}

// ==========================================================
// 7. SWAP REQUESTS (popup and inbox)
// ==========================================================
function sentTo() { return JSON.parse(localStorage.getItem(sentKey()) || "[]"); }  // usernames you already requested

async function loadRequests() {
  if (!REQUESTS_CSV_URL) return [];
  try {
    const separator = REQUESTS_CSV_URL.includes("?") ? "&" : "?";
    const response = await fetch(REQUESTS_CSV_URL + separator + "t=" + Date.now());
    const text = await response.text();
    if (!response.ok || text.trim().startsWith("<")) throw new Error("The link did not return CSV data");
    return parseCSV(text).slice(1).filter(r => r[REQUEST_COLS.to]).map(r => ({
      time: (r[REQUEST_COLS.time] || "").trim().split(" ")[0],
      to: r[REQUEST_COLS.to].trim().toLowerCase(),
      from: (r[REQUEST_COLS.from] || "").trim(),
      fromName: (r[REQUEST_COLS.fromName] || "").trim(),
      skills: (r[REQUEST_COLS.skills] || "").trim(),
      message: (r[REQUEST_COLS.message] || "").trim(),
      contact: (r[REQUEST_COLS.contact] || "").trim()
    }));
  } catch (error) {
    console.error("Could not load requests:", error);
    return [];
  }
}

function requestSkills(text) {   // turns "Can teach you: A. Wants to learn: B" into labelled rows of chips
  if (!text) return "";
  const teach = (text.match(/Can teach you:\s*(.*?)(?:\.\s*Wants to learn:|$)/i) || [])[1];
  const learn = (text.match(/Wants to learn:\s*(.*)$/i) || [])[1];
  const row = (title, list, cls) => list
    ? `<div class="req-row"><div class="req-label">${title}</div>${chipsHTML(toList(list), cls)}</div>` : "";
  return row("Can teach you", teach, "") + row("Wants to learn from you", learn, "want")
    || `<div class="req-row">${esc(text)}</div>`;
}

function requestCard(r) {
  return `<article class="card request-card">
    <div class="req-head"><h3>${esc(firstName(r.fromName))}</h3><span class="req-date">${esc(r.time)}</span></div>
    <div class="req-user">@${esc(r.from)}</div>
    ${requestSkills(r.skills)}
    ${r.message ? `<div class="req-row"><div class="req-label">Message</div><p class="req-msg">${esc(r.message)}</p></div>` : ""}
    <div class="req-contact"><span class="req-label">Contact</span><strong>${esc(r.contact)}</strong></div>
  </article>`;
}

function renderInbox() {
  const mine = currentUser ? requests.filter(r => r.to === currentUser.username).reverse() : [];  // newest first
  document.getElementById("inboxCount").textContent = mine.length ? ` (${mine.length})` : "";
  document.getElementById("welcomeRequests").textContent =
    mine.length ? `You have ${mine.length} swap request(s). Check your Inbox.` : "";
  document.getElementById("inboxList").innerHTML = mine.length
    ? mine.map(requestCard).join("")
    : "<p>No requests yet. Reload the page to check for new ones.</p>";
}

function requestIntro(index) {
  const result = lastResults[index];
  const person = result.person;
  if (!person.username) {
    alert("This is a sample profile, so it can't receive requests.");
    return;
  }
  pendingRequest = result;
  const parts = [];
  if (result.theyCanTeachMe.length) parts.push(`${firstName(person.name)} can teach you ${result.theyCanTeachMe.map(label).join(", ")}`);
  if (result.iCanTeachThem.length) parts.push(`you can teach ${firstName(person.name)} ${result.iCanTeachThem.map(label).join(", ")}`);

  const form = document.getElementById("requestForm");
  document.getElementById("reqName").textContent = firstName(person.name);
  document.getElementById("reqSummary").textContent = parts.join(", and ") + ".";
  const again = sentTo().includes(person.username) ? `You already sent ${firstName(person.name)} a request. This will send another. ` : "";
  document.getElementById("reqNote").textContent = again + `${firstName(person.name)} will see your contact so you can connect.`;
  document.getElementById("reqStatus").textContent = "";
  form.message.value = "";
  form.contact.value = getContact();
  document.getElementById("requestDialog").showModal();
}

async function sendRequest(event) {
  event.preventDefault();
  const form = event.target;
  const status = document.getElementById("reqStatus");
  const target = pendingRequest.person;

  if (REQUEST_POST_URL.includes("YOUR_FORM_ID")) {
    status.textContent = "Swap requests aren't connected yet. Add your Form link in script.js.";
    return;
  }

  const parts = [];
  if (pendingRequest.iCanTeachThem.length) parts.push("Can teach you: " + pendingRequest.iCanTeachThem.map(label).join(", "));
  if (pendingRequest.theyCanTeachMe.length) parts.push("Wants to learn: " + pendingRequest.theyCanTeachMe.map(label).join(", "));
  const contact = form.contact.value.trim();

  const data = new URLSearchParams();
  data.append(REQUEST_ENTRY.to, target.username);
  data.append(REQUEST_ENTRY.from, currentUser.username);
  data.append(REQUEST_ENTRY.fromName, firstName(currentUser.name));
  data.append(REQUEST_ENTRY.skills, parts.join(". "));
  data.append(REQUEST_ENTRY.message, form.message.value.trim());
  data.append(REQUEST_ENTRY.contact, contact);

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  status.textContent = "Sending...";
  try {
    await fetch(REQUEST_POST_URL, { method: "POST", mode: "no-cors", body: data });
    setContact(currentUser.username, contact);
    localStorage.setItem(sentKey(), JSON.stringify([...new Set(sentTo().concat(target.username))]));
    document.getElementById("requestDialog").close();
    renderMatches();   // refresh the cards so this one shows "Request sent"
    el.matchMsg.textContent = `Request sent to ${firstName(target.name)}!`;
  } catch (error) {
    console.error(error);
    status.textContent = "Something went wrong. Check your connection and try again.";
  }
  button.disabled = false;
}

// ==========================================================
// 8. PROFILE (pre-fill Find Match, edit account)
// ==========================================================
function setChecked(group, values) {
  document.querySelectorAll(`input[name="${group}"]`).forEach(box => {
    box.checked = values.includes(box.value);
  });
}

function prefillMatches() {   // ticks the person's own choices in Find Match; they can still change them
  if (!currentUser) return;
  setChecked("teach", currentUser.teach || []);
  setChecked("learn", currentUser.learn || []);
  setChecked("day", currentUser.days || []);
}

function openEditProfile() {
  if (!currentUser.pinHash) {
    alert("Please log out and log in again, then you can edit your profile.");
    return;
  }
  const form = document.getElementById("editForm");
  form.fullName.value = currentUser.name;
  form.section.value = currentUser.section;
  form.contact.value = getContact();
  setChecked("editTeach", currentUser.teach || []);
  setChecked("editLearn", currentUser.learn || []);
  setChecked("editDays", currentUser.days || []);
  setChecked("editMode", [currentUser.mode]);
  document.getElementById("editStatus").textContent = "";
  document.getElementById("editDialog").showModal();
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const status = document.getElementById("editStatus");
  const teach = getChecked("editTeach"), learn = getChecked("editLearn");
  const days = getChecked("editDays"), mode = getChecked("editMode")[0];

  if (teach.length === 0 && learn.length === 0) { status.textContent = "Pick at least one skill to teach or learn."; return; }
  if (days.length === 0 || !mode) { status.textContent = "Pick your free days and a mode."; return; }

  const contact = form.contact.value.trim();
  const updated = { ...currentUser, name: form.fullName.value.trim(), section: form.section.value.trim(),
                    teach, learn, days, mode, editedAt: Date.now() };

  // An edit is a new row in the same sign-up Form. The newest row for a username wins.
  const data = new URLSearchParams();
  data.append(ENTRY.name, updated.name);
  data.append(ENTRY.section, updated.section);
  data.append(ENTRY.teach, teach.join(", "));
  data.append(ENTRY.learn, learn.join(", "));
  data.append(ENTRY.days, days.join(", "));
  data.append(ENTRY.mode, mode);
  data.append(ENTRY.contact, contact);
  data.append(ENTRY.email, "profile-update");
  data.append(ENTRY.username, updated.username);
  data.append(ENTRY.pinHash, updated.pinHash);

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  status.textContent = "Saving...";
  try {
    await fetch(FORM_POST_URL, { method: "POST", mode: "no-cors", body: data });
    currentUser = updated;
    localStorage.setItem("bb_user", JSON.stringify(currentUser));
    setContact(currentUser.username, contact);
    const i = people.findIndex(p => p.username === updated.username);
    if (i >= 0) people[i] = { ...people[i], ...updated };

    document.getElementById("editDialog").close();
    updateAuthUI();   // refreshes the welcome name and re-fills Find Match
    renderStats(); renderBrowse(); renderRadar();
  } catch (error) {
    console.error(error);
    status.textContent = "Something went wrong. Check your connection and try again.";
  }
  button.disabled = false;
}

// ==========================================================
// 9. SETUP (runs once when the page loads)
// ==========================================================
function buildChips(boxId, items, group) {
  document.getElementById(boxId).innerHTML = items.map(item =>
    `<label class="chip-check"><input type="checkbox" name="${group}" value="${esc(item)}"><span>${esc(label(item))}</span></label>`
  ).join("");
}

function getChecked(group) {
  const boxes = document.querySelectorAll(`input[name="${group}"]:checked`);
  return [...boxes].map(box => box.value);
}

function fillSelect(select, items, allText) {
  const options = items.map(item => `<option value="${esc(item)}">${esc(label(item))}</option>`);
  select.innerHTML = `<option value="all">${allText}</option>` + options.join("");
}

const CHIP_GROUPS = [   // [box id, group name, "skills" or "days"]
  ["joinTeach", "joinTeach", "skills"], ["joinLearn", "joinLearn", "skills"], ["joinDays", "joinDays", "days"],
  ["editTeach", "editTeach", "skills"], ["editLearn", "editLearn", "skills"], ["editDays", "editDays", "days"],
  ["teachChips", "teach", "skills"], ["learnChips", "learn", "skills"], ["dayChips", "day", "days"]
];

function buildAllChips() {   // (re)builds every chip group and keeps what was already ticked
  for (const [boxId, group, kind] of CHIP_GROUPS) {
    const ticked = getChecked(group);
    buildChips(boxId, kind === "days" ? DAYS : allSkills, group);
    setChecked(group, ticked);
  }
  const chosen = el.skillFilter.value || "all";
  fillSelect(el.skillFilter, allSkills, "All skills");
  el.skillFilter.value = chosen;
}

// ----- Skills that are not on the list -----
function cleanSkill(text) {
  const skill = text.trim().toLowerCase().replace(/\s+/g, " ");
  return /^[a-z0-9][a-z0-9 +#./&-]{1,29}$/.test(skill) ? skill : "";   // no commas or quotes
}

async function requestSkill(button) {   // sends a request to you; nothing is added until you approve it
  const box = button.closest(".skill-request");
  const input = box.querySelector("input");
  const hint = box.querySelector(".hint");
  const skill = cleanSkill(input.value);

  if (!skill) { hint.textContent = "Use 2 to 30 letters, numbers or spaces."; return; }
  if (allSkills.includes(skill)) { hint.textContent = `${label(skill)} is already on the list. Just tick it above.`; return; }
  if (!SKILL_REQ_URL) { hint.textContent = "Skill requests aren't connected yet."; return; }

  const sent = JSON.parse(localStorage.getItem("bb_skill_requests") || "[]");
  if (sent.includes(skill)) { hint.textContent = `You already requested ${label(skill)}. It is waiting for approval.`; return; }
  if (sent.filter(item => !allSkills.includes(item)).length >= 3) {
    hint.textContent = "You have 3 requests waiting for approval. Try again once they are reviewed.";
    return;
  }

  const by = currentUser
    ? currentUser.username   // signed in: the menu or Edit profile
    : document.getElementById("signupForm").username.value.trim().toLowerCase();   // still signing up
  const data = new URLSearchParams();
  data.append(SKILL_REQ_ENTRY.skill, skill);
  if (SKILL_REQ_ENTRY.by) data.append(SKILL_REQ_ENTRY.by, by);

  button.disabled = true;
  hint.textContent = "Sending...";
  try {
    await fetch(SKILL_REQ_URL, { method: "POST", mode: "no-cors", body: data });
    localStorage.setItem("bb_skill_requests", JSON.stringify(sent.concat(skill)));
    input.value = "";
    hint.textContent = `Requested ${label(skill)}. You can pick it once it is approved.`;
  } catch (error) {
    console.error(error);
    hint.textContent = "Something went wrong. Check your connection and try again.";
  }
  button.disabled = false;
}

function showSkillInBrowse(skill) {   // used by the Skill radar
  el.skillFilter.value = skill;
  el.dayFilter.value = "all";
  el.searchBox.value = "";
  renderBrowse();
  location.hash = "#browse";
}

function connectControls() {
  el.skillFilter.addEventListener("change", renderBrowse);
  el.dayFilter.addEventListener("change", renderBrowse);
  el.matchBtn.addEventListener("click", renderMatches);
  el.mutualOnly.addEventListener("change", renderMatches);
  el.searchBox.addEventListener("input", renderBrowse);
  window.addEventListener("hashchange", showView);

  el.radarList.addEventListener("click", event => {
    const row = event.target.closest("button[data-skill]");
    if (row) showSkillInBrowse(row.dataset.skill);
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-request-skill]");
    if (button) requestSkill(button);
  });
  document.addEventListener("keydown", event => {   // Enter in the request box sends the request instead of submitting the form
    const box = event.target.closest(".skill-request");
    if (event.key === "Enter" && box) { event.preventDefault(); box.querySelector("button").click(); }
  });

  // One listener for every "Request intro" button (they are created later, so we listen on the container)
  el.results.addEventListener("click", event => {
    const button = event.target.closest("button[data-index]");
    if (button) requestIntro(Number(button.dataset.index));
  });
}

async function init() {
  people = await loadData();
  requests = await loadRequests();
  approvedSkills = await loadApprovedSkills();

  // Keep the signed-in person's profile up to date (the Sheet can be a few minutes behind)
  if (currentUser) {
    const i = people.findIndex(p => p.username === currentUser.username);
    const justEdited = currentUser.editedAt && Date.now() - currentUser.editedAt < 15 * 60 * 1000;
    if (i === -1) {
      people.push(currentUser);                          // just signed up, not in the Sheet yet
    } else if (justEdited) {
      people[i] = { ...people[i], ...currentUser };      // recent edit: trust this device
    } else {
      currentUser = { ...currentUser, ...people[i] };    // otherwise the Sheet is the newest
      localStorage.setItem("bb_user", JSON.stringify(currentUser));
    }
  }

  // official list + the skills you approved (students can only request new ones)
  allSkills = computeSkills();
  buildAllChips();
  fillSelect(el.dayFilter, DAYS, "Any day");

  connectControls();
  connectAccounts();
  updateAuthUI();
  renderStats();
  renderBrowse();
  renderRadar();
}

// ==========================================================
// 10. SCREENS (app-style navigation, one page at a time)
// ==========================================================
const VIEWS = ["home", "join", "browse", "matches", "radar", "inbox"];
let currentView = "";

function showView() {
  let name = location.hash.replace("#", "");
  if (!VIEWS.includes(name)) name = "home";
  if (document.getElementById(name).classList.contains("members-only") && !currentUser) name = "join";   // guests go to sign-up

  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === name));
  document.querySelectorAll("nav a").forEach(link => link.classList.toggle("active", link.getAttribute("href") === "#" + name));
  if (name !== currentView) window.scrollTo(0, 0);
  currentView = name;
}

init();